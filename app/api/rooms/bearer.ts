/** The token in `Authorization: Bearer <token>`, or null. */
export const bearer = (header: string | null) =>
  /^Bearer ([!-~]{1,1024})$/i.exec(header?.trim() ?? "")?.[1] ?? null
