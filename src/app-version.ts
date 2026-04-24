import packageJson from "../package.json" with { type: "json" };

export function getAppVersion(): string {
  return packageJson.version;
}
