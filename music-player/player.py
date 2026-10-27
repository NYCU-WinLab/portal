"""Plays the WinLab Music queue on the lab HomePod.

Runs on a machine on the speaker's network (spawner, over its WinLab Wi-Fi).
It follows MUSIC_URL/api/music/player (MUSIC_URL is the portal, server-sent
events) for what members asked for, fetches the audio with yt-dlp, and streams
it over AirPlay (RAOP) with pyatv. It reports what it did back to the same route.

FALLBACK_URL (optional) is a backup queue with the same route (638.winlab.tw on
Spawner): while the portal cannot be reached FAILOVER_AFTER times in a row, the
player follows the backup instead, and goes back as soon as the portal answers.

The door (idm-display on the same host) posts its greeting to ANNOUNCE_LISTEN.
The clip goes into the stream that is already playing: the song pauses, the
clip plays at its own volume, and the song carries on from the same frame. With
nothing playing, the clip gets a stream of its own.

When another sender takes the HomePod (someone's phone), our stream drops. The
player waits until the HomePod is idle again and resumes where it was; if that
takes longer than TAKEN_AFTER_S, it reports "taken" and the queue pauses.
"""

import asyncio
import contextlib
import json
import logging
import os
import shutil
import time
from collections import deque
from pathlib import Path

import aiohttp
import pyatv
import pyatv.protocols.raop as raop
from aiohttp import web
from pyatv.const import DeviceState
from pyatv.interface import MediaMetadata
from pyatv.protocols.raop.audio_source import AudioSource

MUSIC_URL = os.environ["MUSIC_URL"].rstrip("/")
FALLBACK_URL = os.environ.get("FALLBACK_URL", "").rstrip("/")
PLAYER_TOKEN = os.environ["PLAYER_TOKEN"]
HOMEPOD_HOST = os.environ.get("HOMEPOD_HOST", "")
HOMEPOD_NAME = os.environ.get("HOMEPOD_NAME", "車庫")
CACHE_DIR = Path(os.environ.get("CACHE_DIR", "/var/cache/winlab-music"))
CACHE_MAX_BYTES = int(os.environ.get("CACHE_MAX_MB", "2048")) * 1024 * 1024
YT_DLP = os.environ.get("YT_DLP", "yt-dlp")
ANNOUNCE_LISTEN = os.environ.get("ANNOUNCE_LISTEN", "127.0.0.1:8791")

# The HomePod starts sound about this long after we start sending.
BUFFER_S = 2.0
REPORT_EVERY_S = 10
TAKEN_AFTER_S = 90
DOWNLOAD_TIMEOUT_S = 120
FAILOVER_AFTER = 5  # failed connections to the portal, 3 seconds apart
PROBE_EVERY_S = 30  # how often the player asks the portal while on the backup
ANNOUNCE_MAX_BYTES = 8 * 1024 * 1024
ANNOUNCE_GAP_S = 0.3  # silence on each side of a door clip, so the song does not cut straight into it

# What every source is decoded to: the format a HomePod takes over RAOP, samples
# big-endian (pyatv byteswaps its own sources; a Mixer hands frames over as they are).
RATE, CHANNELS, WIDTH = 44100, 2, 2
FRAME = CHANNELS * WIDTH

log = logging.getLogger("music-player")


class Api:
    def __init__(self, session):
        self.session = session
        self.headers = {"authorization": f"Bearer {PLAYER_TOKEN}"}
        # The server followed now: the portal, or FALLBACK_URL while it is down.
        self.base = MUSIC_URL

    async def states(self, base):
        """Each player state the server sends, the current one first."""
        async with self.session.get(
            f"{base}/api/music/player",
            headers={**self.headers, "accept": "text/event-stream"},
            # The portal pings every 25 seconds; a minute of silence is a dead link.
            # A server that does not answer at all fails in 10 seconds, not the OS minutes.
            timeout=aiohttp.ClientTimeout(total=None, sock_connect=10, sock_read=60),
        ) as response:
            response.raise_for_status()
            data = []
            async for raw in response.content:
                line = raw.decode().rstrip("\r\n")
                if line.startswith("data:"):
                    data.append(line[5:].lstrip())
                elif not line and data:
                    yield json.loads("\n".join(data))
                    data = []

    async def report(self, item_id, event, position=None, error=None):
        body = {"itemId": item_id, "event": event}
        if position is not None:
            body["positionS"] = round(max(0.0, position), 1)
        if error:
            body["error"] = error[:1000]
        try:
            async with self.session.post(
                f"{self.base}/api/music/player",
                json=body,
                headers=self.headers,
                timeout=aiohttp.ClientTimeout(total=10),
            ) as response:
                if response.status >= 300:
                    log.warning("report %s: HTTP %s", event, response.status)
        except Exception as e:  # noqa: BLE001  the next report catches up
            log.warning("report %s: %s", event, e)

    async def answers(self, base):
        """Returns once base sends a player state; asks every PROBE_EVERY_S."""
        while True:
            await asyncio.sleep(PROBE_EVERY_S)
            try:
                async with asyncio.timeout(10):
                    async with contextlib.aclosing(self.states(base)) as states:
                        async for _ in states:
                            return
            except Exception:  # noqa: BLE001  still down; ask again later
                pass


async def fetch(video_id):
    """The audio file of a video, downloaded once into CACHE_DIR."""
    for path in CACHE_DIR.glob(f"{video_id}.*"):
        if path.suffix not in (".part", ".ytdl"):
            path.touch()
            return path
    process = await asyncio.create_subprocess_exec(
        YT_DLP, "--quiet", "--no-warnings", "--no-playlist",
        "-f", "bestaudio/best",
        "-o", str(CACHE_DIR / "%(id)s.%(ext)s"),
        "--print", "after_move:filepath",
        f"https://www.youtube.com/watch?v={video_id}",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(process.communicate(), DOWNLOAD_TIMEOUT_S)
    except asyncio.TimeoutError:
        process.kill()
        for part in CACHE_DIR.glob(f"{video_id}.*.part"):
            part.unlink(missing_ok=True)
        raise RuntimeError("下載逾時")
    if process.returncode != 0:
        raise RuntimeError(err.decode(errors="replace").strip().splitlines()[-1:][0] if err else "下載失敗")
    path = Path(out.decode().strip().splitlines()[-1])
    trim_cache()
    return path


async def live_url(video_id):
    """The address of a live stream's audio right now. A live stream has no
    end to download to, so it plays straight from YouTube, from the live edge."""
    process = await asyncio.create_subprocess_exec(
        YT_DLP, "--quiet", "--no-warnings", "--no-playlist",
        "-f", "bestaudio/best", "-g",
        f"https://www.youtube.com/watch?v={video_id}",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(process.communicate(), 60)
    except asyncio.TimeoutError:
        process.kill()
        raise RuntimeError("讀取直播逾時")
    lines = out.decode().strip().splitlines()
    if process.returncode != 0 or not lines:
        raise RuntimeError(err.decode(errors="replace").strip().splitlines()[-1:][0] if err.strip() else "讀不到直播")
    return lines[0]


def trim_cache():
    files = sorted(
        (p for p in CACHE_DIR.iterdir() if p.is_file()),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    total = 0
    for path in files:
        total += path.stat().st_size
        if total > CACHE_MAX_BYTES:
            path.unlink(missing_ok=True)


class Clip:
    """A door clip, decoded, and when the room has heard it."""

    def __init__(self, pcm, volume):
        gap = bytes(int(ANNOUNCE_GAP_S * RATE) * FRAME)
        self.pcm = gap + pcm + gap
        self.pos = 0
        self.volume = volume
        self.heard = asyncio.get_running_loop().create_future()

    def fail(self, error):
        if not self.heard.done():
            self.heard.set_exception(error)


async def decode(data):
    """Any audio file's bytes as raw PCM in the stream format."""
    process = await asyncio.create_subprocess_exec(
        "ffmpeg", "-v", "error", "-i", "pipe:0",
        "-f", "s16be", "-ac", str(CHANNELS), "-ar", str(RATE), "pipe:1",
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, err = await asyncio.wait_for(process.communicate(data), 30)
    if process.returncode != 0 or not out:
        raise RuntimeError(err.decode(errors="replace").strip()[-300:] or "decode failed")
    return out[: len(out) // FRAME * FRAME]


class Mixer(AudioSource):
    """The one source a stream plays: door clips first, the song in between.

    pyatv pulls frames as fast as the HomePod plays them, so while a clip is
    being pulled, the song's ffmpeg simply waits on its pipe. The HomePod plays
    about BUFFER_S behind what we hand out; volume changes wait that long too,
    so they land with the sound they belong to."""

    def __init__(self, homepod, source=None, volume=None):
        self.homepod = homepod
        self.source = source  # ffmpeg input arguments of the song, None for clips alone
        self.ffmpeg = None
        self.song_frames = 0
        self.song_over = source is None
        self.clips = deque()
        self.clip = None
        self.volume = volume  # what the song plays at; clips return to it
        self.hold = None  # the clip whose volume the song waits out, in silence
        self.finished = False
        self.tasks = set()

    async def start(self):
        if self.source:
            self.ffmpeg = await asyncio.create_subprocess_exec(
                "ffmpeg", "-v", "error", *self.source,
                "-vn", "-f", "s16be", "-ac", str(CHANNELS), "-ar", str(RATE), "pipe:1",
                stdout=asyncio.subprocess.PIPE,
            )

    def add(self, clip):
        """Queues a clip; False once the stream has run out and cannot take it."""
        if self.finished:
            return False
        self.clips.append(clip)
        return True

    def later(self, coroutine):
        task = asyncio.get_running_loop().create_task(coroutine)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def heard(self, clip, volume):
        await asyncio.sleep(BUFFER_S)
        if volume is not None:
            await self.set_volume(volume)
        if not clip.heard.done():
            clip.heard.set_result(None)

    async def set_volume(self, level):
        try:
            await self.homepod.volume(level)
        except Exception as e:  # noqa: BLE001  the clip still plays, only louder or softer
            log.warning("volume %s: %s", level, e)

    async def readframes(self, nframes):
        size = nframes * FRAME
        if self.clip is None and self.clips:
            self.clip = self.clips.popleft()
            if self.clip.volume is not None:
                self.later(self.delayed_volume(self.clip.volume))
        if self.clip is not None:
            clip = self.clip
            data = clip.pcm[clip.pos : clip.pos + size]
            clip.pos += len(data)
            if clip.pos >= len(clip.pcm):
                self.clip = None
                if self.clips or self.volume is None or self.song_over:
                    # The next clip, if any, sets its own volume.
                    self.later(self.heard(clip, None))
                else:
                    self.hold = clip
                    self.later(self.restore(clip))
            return data + bytes(size - len(data))
        if self.hold is not None:
            return bytes(size)
        if not self.song_over:
            data = b""
            try:
                data = await self.ffmpeg.stdout.readexactly(size)
            except asyncio.IncompleteReadError as e:
                data = e.partial[: len(e.partial) // FRAME * FRAME]
                self.song_over = True
            self.song_frames += len(data) // FRAME
            if data:
                return data
        self.finished = True
        return AudioSource.NO_FRAMES

    async def restore(self, clip):
        """Gives the song its volume back before any of it plays: silence until
        the HomePod confirms, so the song never plays at the clip's level."""
        try:
            await asyncio.sleep(BUFFER_S)
            # A clip that came in meanwhile keeps its own volume.
            if self.clip is None and not self.clips:
                await self.set_volume(self.volume)
        finally:
            if not clip.heard.done():
                clip.heard.set_result(None)
            if self.hold is clip:
                self.hold = None

    async def delayed_volume(self, level):
        await asyncio.sleep(BUFFER_S)
        await self.set_volume(level)

    def song_position(self, offset):
        return offset + max(0.0, self.song_frames / RATE - BUFFER_S)

    async def close(self):
        self.finished = True
        error = RuntimeError("stream ended before the clip played")
        if self.clip:
            self.clip.fail(error)
        for clip in self.clips:
            clip.fail(error)
        self.clips.clear()
        if self.ffmpeg and self.ffmpeg.returncode is None:
            self.ffmpeg.kill()
            # Not wait(): it never returns while unread audio sits in the pipe.
            await self.ffmpeg.communicate()

    async def get_metadata(self):
        return MediaMetadata()

    @property
    def sample_rate(self):
        return RATE

    @property
    def channels(self):
        return CHANNELS

    @property
    def sample_size(self):
        return WIDTH

    @property
    def duration(self):
        return 0


_open_source = raop.open_source


async def open_source(source, sample_rate, channels, sample_size):
    # stream_file only knows files and URLs; a Mixer is already a source.
    if isinstance(source, Mixer):
        if (sample_rate, channels, sample_size) != (RATE, CHANNELS, WIDTH):
            raise RuntimeError(f"HomePod wants {sample_rate} Hz x{channels} {sample_size * 8} bit")
        await source.start()
        return source
    return await _open_source(source, sample_rate, channels, sample_size)


raop.open_source = open_source


class HomePod:
    """One pyatv connection, made again whenever it drops."""

    def __init__(self):
        self.atv = None
        self.host = HOMEPOD_HOST

    async def connect(self):
        if self.atv is not None:
            return self.atv
        loop = asyncio.get_running_loop()
        confs = []
        if self.host:
            confs = await pyatv.scan(loop, hosts=[self.host], timeout=4)
        if not confs or confs[0].name != HOMEPOD_NAME:
            confs = [c for c in await pyatv.scan(loop, timeout=6) if c.name == HOMEPOD_NAME]
            if not confs:
                raise RuntimeError(f"HomePod {HOMEPOD_NAME} not found")
            self.host = str(confs[0].address)
        self.atv = await pyatv.connect(confs[0], loop)
        return self.atv

    def drop(self):
        if self.atv is not None:
            self.atv.close()
            self.atv = None

    async def idle(self):
        """Whether nothing else is playing on it, read on a fresh connection."""
        self.drop()
        atv = await self.connect()
        playing = await atv.metadata.playing()
        return playing.device_state in (DeviceState.Idle, DeviceState.Stopped, DeviceState.Paused)

    async def volume(self, level):
        atv = await self.connect()
        if abs(float(atv.audio.volume) - level) >= 1:
            await atv.audio.set_volume(level)


class Player:
    def __init__(self, api):
        self.api = api
        self.homepod = HomePod()
        self.want = None  # the latest state from the server
        self.changed = asyncio.Event()
        self.task = None  # the running play() task
        self.playing = None  # item id of the running task
        self.offset = 0.0  # where the song started in the running stream
        self.mixer = None  # the running stream's source, song or clips alone
        self.airplay = asyncio.Lock()  # one stream to the HomePod at a time
        self.state = "idle"

    def position(self):
        if self.state != "playing" or self.mixer is None:
            return self.offset
        return self.mixer.song_position(self.offset)

    async def follow_from(self, base):
        """Follows one server until its stream ends; True if it sent a state."""
        got = False
        try:
            async for state in self.api.states(base):
                got = True
                self.want = state
                self.changed.set()
        except Exception as e:  # noqa: BLE001
            log.warning("follow %s: %s", base, e)
        return got

    async def switch(self, base):
        """Follows another server. The old server's song stops first, so none of
        its reports (taken would pause the queue) reach the new server."""
        await self.stop()
        self.offset = 0.0
        self.playing = None
        self.state = "idle"
        self.api.base = base
        log.warning("following %s", base)

    async def follow(self):
        failures = 0
        probe = None  # asks the portal while the player follows the backup
        while True:
            base = self.api.base
            if base != MUSIC_URL and probe is None:
                probe = asyncio.create_task(self.api.answers(MUSIC_URL))
            stream = asyncio.create_task(self.follow_from(base))
            done, _ = await asyncio.wait(
                {stream, probe} - {None}, return_when=asyncio.FIRST_COMPLETED
            )
            if probe in done:
                probe = None
                stream.cancel()
                await asyncio.gather(stream, return_exceptions=True)
                await self.switch(MUSIC_URL)
                continue
            if base == MUSIC_URL:
                failures = 0 if stream.result() else failures + 1
                if FALLBACK_URL and failures >= FAILOVER_AFTER:
                    failures = 0
                    await self.switch(FALLBACK_URL)
                    continue
            await asyncio.sleep(3)

    async def heartbeat(self):
        while True:
            await asyncio.sleep(REPORT_EVERY_S)
            await self.api.report(self.playing, self.state, self.position())

    async def prefetch(self, video_ids):
        for video_id in video_ids:
            try:
                await fetch(video_id)
            except Exception as e:  # noqa: BLE001  it is fetched again when its turn comes
                log.info("prefetch %s: %s", video_id, e)

    async def stop(self):
        if self.task and not self.task.done():
            self.task.cancel()
            try:
                await self.task
            except BaseException:  # noqa: BLE001
                pass
        self.task = None

    async def run(self):
        asyncio.create_task(self.follow())
        asyncio.create_task(self.heartbeat())
        prefetching = None
        while True:
            await self.changed.wait()
            self.changed.clear()
            want = self.want
            current = want["current"]
            if want["paused"] or current is None:
                if self.task:
                    self.offset = self.position()
                    await self.stop()
                self.state = "idle"
                # Only a song this player played has a position to keep; a fresh start knows none.
                mine = current and self.playing == current["itemId"]
                await self.api.report(current and current["itemId"], "idle", self.offset if mine else None)
                self.playing = None
                continue
            if self.mixer and self.mixer.clip is not None:
                self.mixer.volume = want["volume"]  # set when the door clip ends
            else:
                try:
                    await self.homepod.volume(want["volume"])
                    if self.mixer:
                        self.mixer.volume = want["volume"]
                except Exception as e:  # noqa: BLE001
                    log.warning("volume: %s", e)
                    self.homepod.drop()
            if self.playing != current["itemId"] or not self.task or self.task.done():
                await self.stop()
                self.playing = current["itemId"]
                self.task = asyncio.create_task(self.play(current, want["volume"]))
            if want["upcoming"] and (prefetching is None or prefetching.done()):
                prefetching = asyncio.create_task(self.prefetch(want["upcoming"]))

    async def play(self, item, volume):
        item_id, offset = item["itemId"], float(item["startAtS"] or 0)
        # A song has a length; a live stream (a radio channel) has none.
        live = not item.get("durationS")
        self.state, self.offset = "loading", offset
        await self.api.report(item_id, "loading", offset)
        path = None
        while True:
            try:
                if live:
                    source = ["-i", await live_url(item["videoId"])]
                else:
                    path = path or await fetch(item["videoId"])
                    source = ["-ss", f"{offset:.1f}", "-i", str(path)]
            except Exception as e:  # noqa: BLE001
                log.warning("fetch %s: %s", item["videoId"], e)
                self.state = "idle"
                await self.api.report(item_id, "failed", offset, str(e) or type(e).__name__)
                return
            ended, offset = await self.stream(item, source, offset, volume)
            if ended:
                self.state = "idle"
                await self.api.report(item_id, "ended", offset)
                return
            # Someone else took the HomePod: wait for it to go quiet.
            self.state, self.offset = "waiting", offset
            await self.api.report(item_id, "waiting", offset)
            since = time.monotonic()
            quiet = 0
            while quiet < 2:
                await asyncio.sleep(1.5)
                try:
                    quiet = quiet + 1 if await self.homepod.idle() else 0
                except Exception as e:  # noqa: BLE001
                    log.info("idle check: %s", e)
                    self.homepod.drop()
                    quiet = 0
                if time.monotonic() - since > TAKEN_AFTER_S:
                    self.state = "idle"
                    await self.api.report(item_id, "taken", offset)
                    return
            offset = max(0.0, offset - 1)
            log.info("resuming %s at %.0f s", item["videoId"], offset)

    async def stream(self, item, source, offset, volume):
        """Streams ffmpeg's input source, which starts at offset; (True, end)
        when it ran out, (False, position) when another sender cut us off."""
        async with self.airplay:
            mixer = Mixer(self.homepod, source, volume)
            self.mixer, self.offset = mixer, offset
            try:
                atv = await self.homepod.connect()
                try:
                    await self.homepod.volume(volume)
                except Exception as e:  # noqa: BLE001
                    log.warning("volume: %s", e)
                self.state = "playing"
                await self.api.report(item["itemId"], "playing", offset)
                metadata = MediaMetadata(title=item["title"], artist=item["artist"])
                try:
                    await atv.stream.stream_file(mixer, metadata=metadata)
                except asyncio.CancelledError:
                    raise
                except Exception as e:  # noqa: BLE001
                    position = self.position()
                    log.info("stream cut at %.0f s: %s", position, e)
                    self.homepod.drop()
                    return False, position
                position = self.position()
                total = item.get("durationS")
                if total and position < total - 8:
                    log.info("stream ended early at %.0f of %s s", position, total)
                    self.homepod.drop()
                    return False, position
                return True, position
            finally:
                self.offset = self.position()
                self.mixer = None
                await mixer.close()

    async def announce(self, pcm, volume):
        """Plays a door clip; "mixed" into the running stream, or "alone" in
        one of its own. Returns once the room has heard it."""
        clip = Clip(pcm, volume)
        while True:
            if self.mixer and self.mixer.add(clip):
                await clip.heard
                return "mixed"
            if not self.airplay.locked():
                break
            # A stream is starting or finishing; it takes the clip or frees the HomePod.
            await asyncio.sleep(0.1)
        async with self.airplay:
            mixer = Mixer(self.homepod)
            mixer.add(clip)
            self.mixer = mixer
            try:
                atv = await self.homepod.connect()
                mixer.volume = float(atv.audio.volume)
                try:
                    await atv.stream.stream_file(mixer, metadata=MediaMetadata(title="門口", artist="WinLab"))
                except Exception:
                    self.homepod.drop()
                    raise
                # The stream returns when the last frame is sent; the room hears it BUFFER_S later.
                await clip.heard
                return "alone"
            finally:
                self.mixer = None
                await mixer.close()


def announce_app(player):
    async def handle(request):
        t0 = time.monotonic()
        try:
            volume = float(request.query["volume"]) if "volume" in request.query else None
        except ValueError:
            return web.json_response({"ok": False, "error": "bad volume"}, status=400)
        data = await request.read()
        if not data:
            return web.json_response({"ok": False, "error": "no audio"}, status=400)
        try:
            pcm = await decode(data)
            how = await asyncio.wait_for(player.announce(pcm, volume), len(pcm) / (RATE * FRAME) + 60)
        except Exception as e:  # noqa: BLE001
            error = str(e) or type(e).__name__
            log.warning("announce: %s", error)
            return web.json_response({"ok": False, "error": error}, status=502)
        ms = int((time.monotonic() - t0) * 1000)
        log.info("announce %s, %d ms", how, ms)
        return web.json_response({"ok": True, "how": how, "ms": ms})

    app = web.Application(client_max_size=ANNOUNCE_MAX_BYTES)
    app.router.add_post("/announce", handle)
    return app


async def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    for noisy in ("pyatv", "aiohttp", "zeroconf"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg not found")
    async with aiohttp.ClientSession() as session:
        player = Player(Api(session))
        runner = web.AppRunner(announce_app(player))
        await runner.setup()
        host, port = ANNOUNCE_LISTEN.rsplit(":", 1)
        await web.TCPSite(runner, host, int(port)).start()
        await player.run()


if __name__ == "__main__":
    asyncio.run(main())
