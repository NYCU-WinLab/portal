"""Plays the WinLab Music queue on the lab HomePod.

Runs on a machine on the speaker's network (spawner, over its WinLab Wi-Fi).
It long-polls MUSIC_URL/api/music/player (MUSIC_URL is the portal) for what
members asked for, fetches the audio with yt-dlp, and streams it over AirPlay (RAOP) with pyatv. It reports
what it did back to the same route.

When another sender takes the HomePod (the door greeting, someone's phone),
our stream drops. The player waits until the HomePod is idle again and
resumes where it was; if that takes longer than TAKEN_AFTER_S, it reports
"taken" and the queue pauses.
"""

import asyncio
import logging
import os
import shutil
import subprocess
import time
from pathlib import Path

import aiohttp
import pyatv
from pyatv.const import DeviceState
from pyatv.interface import MediaMetadata

MUSIC_URL = os.environ["MUSIC_URL"].rstrip("/")
PLAYER_TOKEN = os.environ["PLAYER_TOKEN"]
HOMEPOD_HOST = os.environ.get("HOMEPOD_HOST", "")
HOMEPOD_NAME = os.environ.get("HOMEPOD_NAME", "車庫")
CACHE_DIR = Path(os.environ.get("CACHE_DIR", "/var/cache/winlab-music"))
CACHE_MAX_BYTES = int(os.environ.get("CACHE_MAX_MB", "2048")) * 1024 * 1024
YT_DLP = os.environ.get("YT_DLP", "yt-dlp")

# The HomePod starts sound about this long after we start sending.
BUFFER_S = 2.0
REPORT_EVERY_S = 10
TAKEN_AFTER_S = 90
DOWNLOAD_TIMEOUT_S = 120

log = logging.getLogger("music-player")


class Api:
    def __init__(self, session):
        self.session = session
        self.headers = {"authorization": f"Bearer {PLAYER_TOKEN}"}

    async def state(self, version):
        async with self.session.get(
            f"{MUSIC_URL}/api/music/player",
            params={"version": str(version)},
            headers=self.headers,
            timeout=aiohttp.ClientTimeout(total=40),
        ) as response:
            response.raise_for_status()
            return await response.json()

    async def report(self, item_id, event, position=None, error=None):
        body = {"itemId": item_id, "event": event}
        if position is not None:
            body["positionS"] = round(max(0.0, position), 1)
        if error:
            body["error"] = error[:1000]
        try:
            async with self.session.post(
                f"{MUSIC_URL}/api/music/player",
                json=body,
                headers=self.headers,
                timeout=aiohttp.ClientTimeout(total=10),
            ) as response:
                if response.status >= 300:
                    log.warning("report %s: HTTP %s", event, response.status)
        except Exception as e:  # noqa: BLE001  the next report catches up
            log.warning("report %s: %s", event, e)


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
        self.started = 0.0  # monotonic time the song's position was `offset`
        self.offset = 0.0
        self.state = "idle"

    def position(self):
        if self.state != "playing":
            return self.offset
        return self.offset + max(0.0, time.monotonic() - self.started - BUFFER_S)

    async def poll(self):
        version = -1
        while True:
            try:
                state = await self.api.state(version)
                if state["version"] != version or self.want is None:
                    version = state["version"]
                    self.want = state
                    self.changed.set()
            except Exception as e:  # noqa: BLE001
                log.warning("poll: %s", e)
                await asyncio.sleep(5)

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
        asyncio.create_task(self.poll())
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
                await self.api.report(current and current["itemId"], "idle", self.offset if current else None)
                self.playing = None
                continue
            try:
                await self.homepod.volume(want["volume"])
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
        # pyatv reads a plain file object, so ffmpeg runs as a plain process.
        ffmpeg = subprocess.Popen(
            ["ffmpeg", "-v", "error", *source,
             "-vn", "-ac", "2", "-ar", "44100", "-f", "mp3", "-b:a", "256k", "-"],
            stdout=subprocess.PIPE,
        )
        try:
            atv = await self.homepod.connect()
            try:
                await self.homepod.volume(volume)
            except Exception as e:  # noqa: BLE001
                log.warning("volume: %s", e)
            self.started, self.offset, self.state = time.monotonic(), offset, "playing"
            await self.api.report(item["itemId"], "playing", offset)
            metadata = MediaMetadata(title=item["title"], artist=item["artist"])
            try:
                await atv.stream.stream_file(ffmpeg.stdout, metadata=metadata)
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
            ffmpeg.kill()
            ffmpeg.stdout.close()
            ffmpeg.wait()


async def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    for noisy in ("pyatv", "aiohttp", "zeroconf"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg not found")
    async with aiohttp.ClientSession() as session:
        await Player(Api(session)).run()


if __name__ == "__main__":
    asyncio.run(main())
