export function isLoopbackHost(host: string | undefined): boolean {
  return typeof host === "string" && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i.test(host);
}
