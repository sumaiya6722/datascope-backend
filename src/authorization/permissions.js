export const ROLES = Object.freeze({
  ADMINISTRATOR: "administrator",
  DATA_ANALYST: "dataAnalyst",
  VIEWER: "viewer",
});

export const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.ADMINISTRATOR]: Object.freeze([
    "user:manage",
    "dataset:read",
    "dataset:manage",
    "dataset:permissions:manage",
    "dataset:records:read",
    "dataset:search:basic",
    "dataset:search:advanced",
    "dataset:filters:basic",
    "dataset:filters:multiple",
    "view:manage:personal",
    "view:access:shared",
    "dataset:export",
    "dataset:analyze",
    "analytics:admin",
    "system:manage",
  ]),
  [ROLES.DATA_ANALYST]: Object.freeze([
    "dataset:read",
    "dataset:records:read",
    "dataset:search:basic",
    "dataset:search:advanced",
    "dataset:filters:basic",
    "dataset:filters:multiple",
    "view:manage:personal",
    "view:access:shared",
    "dataset:export",
    "dataset:analyze",
  ]),
  [ROLES.VIEWER]: Object.freeze([
    "dataset:read",
    "dataset:records:read",
    "dataset:search:basic",
    "dataset:filters:basic",
    "view:access:shared",
  ]),
});

export function getRolePermissions(role) {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function hasPermission(role, permission) {
  return getRolePermissions(role).includes(permission);
}
