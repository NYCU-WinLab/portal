import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

// One member's picture beside their name in a row; the name is the label,
// so the avatar itself is decoration. The route answers 404 without a
// picture, and the initial shows.
function MemberAvatar({ id, name }: { id: string; name: string }) {
  return (
    <Avatar aria-hidden>
      <AvatarImage src={`/avatars/${id}`} alt="" />
      <AvatarFallback>{Array.from(name.trim())[0] ?? "?"}</AvatarFallback>
    </Avatar>
  )
}

export { MemberAvatar }
