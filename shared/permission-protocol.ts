export interface PermissionIdentity {
  pluginID: string;
  sessionID: string;
  requestID: string;
}

export interface NativePermission {
  sessionID: string;
  requestID: string;
  resources: string[];
  message?: string;
}

export interface PendingPermission extends NativePermission, PermissionIdentity {
  status: "pending" | "replying";
}

export type PermissionDecision = "once" | "reject";

export type PermissionReply = PermissionIdentity & {
  type: "permission.reply";
  decision: PermissionDecision;
};

export type PluginPermissionMessage =
  | { type: "permissions.sync"; pluginID: string; requests: NativePermission[] }
  | { type: "permission.result"; commandID: string; error?: string };

export interface PermissionCommand extends PermissionReply {
  commandID: string;
}

export const permissionKey = (identity: PermissionIdentity) =>
  JSON.stringify([identity.pluginID, identity.sessionID, identity.requestID]);

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const identifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 1_024;

export function isPermissionReply(value: unknown): value is PermissionReply {
  return object(value) && value.type === "permission.reply"
    && identifier(value.pluginID) && identifier(value.sessionID) && identifier(value.requestID)
    && (value.decision === "once" || value.decision === "reject");
}

export function isPermissionCommand(value: unknown): value is PermissionCommand {
  return isPermissionReply(value) && "commandID" in value && identifier(value.commandID);
}

function isNativePermission(value: unknown): value is NativePermission {
  return object(value) && identifier(value.sessionID) && identifier(value.requestID)
    && Array.isArray(value.resources) && value.resources.length > 0 && value.resources.length <= 1_000
    && value.resources.every((resource) => typeof resource === "string" && resource.length > 0 && resource.length <= 16_384)
    && (value.message === undefined || typeof value.message === "string" && value.message.length <= 16_384);
}

export function isPluginPermissionMessage(value: unknown): value is PluginPermissionMessage {
  if (!object(value)) return false;
  if (value.type === "permissions.sync") {
    return identifier(value.pluginID) && Array.isArray(value.requests)
      && value.requests.length <= 1_000 && value.requests.every(isNativePermission);
  }
  return value.type === "permission.result" && identifier(value.commandID)
    && (value.error === undefined || typeof value.error === "string" && value.error.length <= 16_384);
}
