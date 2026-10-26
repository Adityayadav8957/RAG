import { api } from "./api";

/** Shared cache keys + fetchers so the admin page can warm them before its (lazy) tables have loaded. */
export const USERS_KEY = "admin/users";
export const INVITES_KEY = "admin/invitations";
export const fetchUsers = () => api.adminUsers();
export const fetchInvites = () => api.invitations();
