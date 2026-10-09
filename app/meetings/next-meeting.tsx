import { AvatarStack } from "@/components/avatar-stack"
import { Countdown } from "@/components/countdown"
import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusMeta,
  FocusTitle,
} from "@/components/focus"
import type { ScheduledMeeting } from "@/lib/actions/meetings-shared"
import { dateLabel } from "@/lib/leave-dates"

const kindLabel = { speaker: "演講", thesis: "碩論" } as const

// The meetings app's focus: how long until the next meeting, who presents
// what, and who asks. Also the home page's focus.
export function NextMeeting({ meeting }: { meeting: ScheduledMeeting | null }) {
  if (!meeting)
    return (
      <Focus>
        <FocusLabel>下一場</FocusLabel>
        <FocusTitle>還沒排</FocusTitle>
      </Focus>
    )
  const startsAt = `${meeting.date}T${meeting.startsAt}:00+08:00`
  const who =
    meeting.kind === "speaker"
      ? "演講"
      : meeting.presenter
        ? `${meeting.presenter.name}${meeting.kind === "thesis" ? " 碩論" : ""}報告`
        : "報告人未排"
  return (
    <Focus>
      <FocusLabel>
        下一場 {dateLabel(meeting.date)}
        {meeting.label && ` ${meeting.label}`}
      </FocusLabel>
      <FocusTitle>
        <FocusHighlight>
          <Countdown to={startsAt}>進行中</Countdown>
        </FocusHighlight>
        {" 後，"}
        {who}
      </FocusTitle>
      {meeting.title &&
        (meeting.paper?.url ? (
          <a
            href={meeting.paper.url}
            target="_blank"
            rel="noreferrer"
            className="underline-offset-4 hover:underline"
          >
            {meeting.title}
          </a>
        ) : (
          <p>{meeting.title}</p>
        ))}
      <FocusMeta>
        {meeting.questioners.length > 0 && (
          <AvatarStack people={meeting.questioners} />
        )}
        <span>
          {meeting.location}　{meeting.startsAt}
        </span>
        {meeting.kind !== "regular" && meeting.kind !== "holiday" && (
          <span>{kindLabel[meeting.kind]}</span>
        )}
      </FocusMeta>
    </Focus>
  )
}
