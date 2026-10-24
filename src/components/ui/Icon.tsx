import type { SVGProps } from 'react'

export type IconName =
  | 'audio'
  | 'camera'
  | 'cameraOff'
  | 'chat'
  | 'check'
  | 'chevron'
  | 'collapse'
  | 'copy'
  | 'controls'
  | 'deafen'
  | 'download'
  | 'expand'
  | 'edit'
  | 'eye'
  | 'eyeOff'
  | 'gamepad'
  | 'headphones'
  | 'hash'
  | 'home'
  | 'image'
  | 'info'
  | 'keyboard'
  | 'layout'
  | 'lock'
  | 'leave'
  | 'mic'
  | 'micOff'
  | 'menu'
  | 'more'
  | 'phone'
  | 'star'
  | 'bell'
  | 'moon'
  | 'music'
  | 'pause'
  | 'pip'
  | 'play'
  | 'plus'
  | 'popout'
  | 'refresh'
  | 'screen'
  | 'search'
  | 'send'
  | 'settings'
  | 'skip'
  | 'trash'
  | 'users'
  | 'warning'
  | 'volumeOff'
  | 'x'

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
}

const paths: Record<IconName, React.ReactNode> = {
  phone: <path d="m7 3 3 5-2 2a15 15 0 0 0 6 6l2-2 5 3c-1 4-3 5-6 4A22 22 0 0 1 3 9C2 6 3 4 7 3Z" />,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z" />,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6" /></>,
  moon: <path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10Z" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
  edit: <><path d="m15 4 5 5M4 20l4-1L20 7a2.1 2.1 0 0 0-3-3L5 16l-1 4Z" /><path d="M12 20h8" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  audio: (
    <>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18 6a8.5 8.5 0 0 1 0 12" />
    </>
  ),
  camera: (
    <>
      <path d="m16 10 4.6-2.7a.9.9 0 0 1 1.4.8v7.8a.9.9 0 0 1-1.4.8L16 14" />
      <rect width="13" height="12" x="3" y="6" rx="2" />
    </>
  ),
  cameraOff: (
    <>
      <path d="m16 10 4.6-2.7a.9.9 0 0 1 1.4.8v7.8a.9.9 0 0 1-.3.7" />
      <rect width="13" height="12" x="3" y="6" rx="2" />
      <path d="m3 3 18 18" />
    </>
  ),
  chat: (
    <>
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3v-6a4 4 0 0 1-1-2.7V7a4 4 0 0 1 4-4h11a4 4 0 0 1 4 4v8Z" />
      <path d="M7 9h10" />
      <path d="M7 13h6" />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  collapse: (
    <>
      <path d="M9 3v6H3" />
      <path d="m3 9 6-6" />
      <path d="M15 3v6h6" />
      <path d="m21 9-6-6" />
      <path d="M9 21v-6H3" />
      <path d="m3 15 6 6" />
      <path d="M15 21v-6h6" />
      <path d="m21 15-6 6" />
    </>
  ),
  copy: (
    <>
      <rect width="11" height="11" x="9" y="9" rx="2" />
      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
    </>
  ),
  controls: (
    <>
      <path d="M4 6h10" />
      <path d="M18 6h2" />
      <circle cx="16" cy="6" r="2" />
      <path d="M4 12h2" />
      <path d="M10 12h10" />
      <circle cx="8" cy="12" r="2" />
      <path d="M4 18h7" />
      <path d="M15 18h5" />
      <circle cx="13" cy="18" r="2" />
    </>
  ),
  deafen: (
    <>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <path d="M18 19c0 1.1-.9 2-2 2h-1v-7h3a2 2 0 0 1 2 2v1" />
      <path d="M6 14h3v7H8a2 2 0 0 1-2-2v-5Z" />
      <path d="m4 4 16 16" />
    </>
  ),
  expand: (
    <>
      <path d="M8 3H3v5" />
      <path d="m3 3 6 6" />
      <path d="M16 3h5v5" />
      <path d="m21 3-6 6" />
      <path d="M8 21H3v-5" />
      <path d="m3 21 6-6" />
      <path d="M16 21h5v-5" />
      <path d="m21 21-6-6" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.2A10.7 10.7 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.2 3" />
      <path d="M6.6 6.6C3.7 8.4 2 12 2 12s3.5 6 10 6c1 0 2-.2 2.8-.4" />
      <path d="M9.8 9.8A3 3 0 0 0 14.2 14.2" />
    </>
  ),
  gamepad: (
    <>
      <path d="M6.5 8h11a4.5 4.5 0 0 1 4.4 5.4l-.7 3.2a2.4 2.4 0 0 1-4 1.2l-2.1-2.1H8.9l-2.1 2.1a2.4 2.4 0 0 1-4-1.2l-.7-3.2A4.5 4.5 0 0 1 6.5 8Z" />
      <path d="M7 11v4M5 13h4M16 12h.01M19 14h.01" />
    </>
  ),
  headphones: (
    <>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <path d="M18 19c0 1.1-.9 2-2 2h-1v-7h3a2 2 0 0 1 2 2v3Z" />
      <path d="M6 14h3v7H8a2 2 0 0 1-2-2v-5Z" />
    </>
  ),
  hash: <path d="M5 9h14M4 15h14M10 3 8 21M16 3l-2 18" />,
  home: <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1V10Z" />,
  image: (
    <>
      <rect width="18" height="16" x="3" y="4" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m21 15-5-5L5 20" />
    </>
  ),
  keyboard: (
    <>
      <rect width="20" height="15" x="2" y="5" rx="2" />
      <path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M7 17h10" />
    </>
  ),
  layout: (
    <>
      <rect width="20" height="18" x="2" y="3" rx="2" />
      <path d="M2 10h20" />
      <path d="M9 10v11" />
    </>
  ),
  leave: (
    <>
      <path d="M10 8a6 6 0 0 1 8 0" />
      <path d="M6 10.5c-.9.9-1.5 2-1.8 3.2-.2.8.2 1.6.9 2l2 1.1c.8.4 1.7.1 2.1-.7l.8-1.6a10 10 0 0 1 4 0l.8 1.6c.4.8 1.3 1.1 2.1.7l2-1.1c.7-.4 1.1-1.2.9-2A9.6 9.6 0 0 0 18 10.5" />
    </>
  ),
  mic: (
    <>
      <rect width="8" height="13" x="8" y="3" rx="4" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M8 21h8" />
    </>
  ),
  micOff: (
    <>
      <path d="M9 9v2a3 3 0 0 0 5.1 2.1" />
      <path d="M15.9 10.4V7a4 4 0 0 0-7.6-1.7" />
      <path d="M5 11a7 7 0 0 0 11.9 5" />
      <path d="M19 11a7 7 0 0 1-.7 3.1" />
      <path d="M12 18v3" />
      <path d="M8 21h8" />
      <path d="m3 3 18 18" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  music: (
    <>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </>
  ),
  pause: (
    <>
      <rect width="4" height="16" x="6" y="4" rx="1" />
      <rect width="4" height="16" x="14" y="4" rx="1" />
    </>
  ),
  pip: (
    <>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <rect width="8" height="6" x="11" y="11" rx="1" />
    </>
  ),
  play: <path d="m8 5 11 7-11 7V5Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  popout: (
    <>
      <rect width="18" height="15" x="3" y="5" rx="2" />
      <path d="M14 3h7v7" />
      <path d="m13 11 8-8" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>
  ),
  screen: (
    <>
      <rect width="18" height="13" x="3" y="4" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="m9 10 3-3 3 3" />
      <path d="M12 7v6" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 5 5" />
    </>
  ),
  send: (
    <>
      <path d="m22 2-7 20-4-9-9-4 20-7Z" />
      <path d="M22 2 11 13" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
  skip: (
    <>
      <path d="m5 5 10 7-10 7V5Z" />
      <path d="M19 5v14" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m19 6-1 15H6L5 6" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
      <path d="M16 3.1a4 4 0 0 1 0 7.8" />
    </>
  ),
  warning: (
    <>
      <path d="m21 19-8.3-14.4a.8.8 0 0 0-1.4 0L3 19a.8.8 0 0 0 .7 1.2h16.6A.8.8 0 0 0 21 19Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  volumeOff: (
    <>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="m22 9-6 6" />
      <path d="m16 9 6 6" />
    </>
  ),
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
}

export const Icon = ({ name, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.8"
    viewBox="0 0 24 24"
    {...props}
  >
    {paths[name]}
  </svg>
)
