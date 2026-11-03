export const SENSITIVE_FILES = [
  ".env",
  ".env.*",
  "appsettings.json",
  "appsettings.*.json",
  ".npmrc",
  ".pypirc",
  ".netrc",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  "id_dsa",
  "*.pem",
  "*.key",
  ".aws/credentials",
  ".kube/config",
] as const;

const patterns = SENSITIVE_FILES.map((pattern) => new RegExp(
  `(?:^|/)${pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`,
  "i",
));

export function isSensitiveFile(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return patterns.some((pattern) => pattern.test(normalized));
}
