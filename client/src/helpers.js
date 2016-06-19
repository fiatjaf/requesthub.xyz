export function prettify (raw) {
  raw = raw.trim()
  try {
    let parsed = JSON.parse(raw)
    return JSON.stringify(parsed, null, 2)
  } catch (e) {
    return raw
  }
}
