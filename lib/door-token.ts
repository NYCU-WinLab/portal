/** The curl line that opens the door with a token, shown on /door/tokens. */
export const curlLine = (token: string) =>
  `curl -X POST -H "Authorization: Bearer ${token}" https://portal.winlab.tw/api/door/open`
