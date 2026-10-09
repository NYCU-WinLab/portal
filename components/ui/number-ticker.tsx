import { cn } from "@/lib/utils"

const digits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]

// A number whose digits roll to their new value on the spring. Each digit is
// a column of 0 to 9 clipped to one line; data-digit slides it. Screen
// readers get the plain number.
function NumberTicker({
  value,
  className,
}: {
  /** A whole number, 0 or more. */
  value: number
  className?: string
}) {
  const text = String(Math.max(0, Math.round(value)))
  return (
    <span
      data-slot="number-ticker"
      className={cn("inline-flex tabular-nums", className)}
    >
      <span className="sr-only">{text}</span>
      {text.split("").map((digit, index) => (
        <span
          // Keyed from the right, so a column keeps rolling when the number
          // gains or loses a digit on the left.
          key={text.length - index}
          aria-hidden
          className="inline-flex h-lh items-start overflow-hidden"
        >
          <span data-digit={digit} className="flex digit-roll flex-col">
            {digits.map((row) => (
              <span key={row} className="h-lh">
                {row}
              </span>
            ))}
          </span>
        </span>
      ))}
    </span>
  )
}

export { NumberTicker }
