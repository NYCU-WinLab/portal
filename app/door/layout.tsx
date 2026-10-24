import type { Metadata } from "next"

// Added to a home screen, /door becomes the Door app. Its icon opens /door,
// which waits for a press like the web page.
export const metadata: Metadata = {
  manifest: "/door/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Door", statusBarStyle: "black" },
  icons: { apple: "/door/apple-touch-icon.png" },
}

export default function DoorLayout({ children }: LayoutProps<"/door">) {
  return children
}
