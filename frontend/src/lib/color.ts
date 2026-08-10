type Rgb = readonly [number, number, number]

const BLACK = "#000000"
const WHITE = "#ffffff"

function parseHex(color: string): Rgb | null {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color.trim())
  if (!match) return null

  const value = match[1].length === 3
    ? [...match[1]].map((channel) => channel + channel).join("")
    : match[1]

  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255) as unknown as Rgb
}

function luminance(rgb: Rgb): number {
  return rgb.reduce((sum, channel, index) => {
    const linear = channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
    return sum + linear * [0.2126, 0.7152, 0.0722][index]
  }, 0)
}

function contrast(first: Rgb, second: Rgb): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Preserve an accessible preferred color, otherwise choose the higher-contrast black or white. */
export function readableForeground(background: string, preferred?: string): string {
  const backgroundRgb = parseHex(background)
  if (!backgroundRgb) return preferred ?? BLACK

  const preferredRgb = preferred ? parseHex(preferred) : null
  if (preferred && preferredRgb && contrast(backgroundRgb, preferredRgb) >= 4.5) return preferred

  const blackRgb: Rgb = [0, 0, 0]
  const whiteRgb: Rgb = [1, 1, 1]
  return contrast(backgroundRgb, blackRgb) >= contrast(backgroundRgb, whiteRgb) ? BLACK : WHITE
}
