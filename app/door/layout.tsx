import type { Metadata } from "next"

// Added to a home screen, /door becomes the Door app: its icon launches
// /door/go, which opens the door on launch.
export const metadata: Metadata = {
  manifest: "/door/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Door", statusBarStyle: "black" },
  icons: { apple: "/door/apple-touch-icon.png" },
}

export default function DoorLayout({ children }: LayoutProps<"/door">) {
  return children
}
