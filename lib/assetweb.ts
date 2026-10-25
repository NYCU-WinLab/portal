// NYCU's property system (財物管理系統, assetweb). Not an official API: read
// off its own pages' JavaScript. Every call signs in as the account whose
// property the lab keeps (ASSETWEB_SERVICE_USER / ASSETWEB_SERVICE_PASSWORD)
// and reads what it holds, since the session is a plain Tomcat cookie. One
// sign-in reads both kinds the lab keeps.
//   POST LoginAction                                  -> JSESSIONID
//   POST ActionServlet?bean=ppt.ppt0195.PPT0195Do&action=G -> 財產 (NT$10,000+)
//   POST ActionServlet?bean=ncs.ncs0195.NCS0195Do&action=G -> 非消耗品 (NT$6,000+)
// Three wrong passwords lock the account until the property office resets
// it, so a refused sign-in is never retried.

const base = () =>
  (process.env.ASSETWEB_URL ?? "https://assetweb.nycu.edu.tw").replace(
    /\/$/,
    ""
  )
const timeout = () => AbortSignal.timeout(15_000)

// Without a browser's headers LoginAction answers 500, and without a
// Referer the data servlet answers 非合法的要求.
const browser = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  "x-requested-with": "XMLHttpRequest",
}

export const assetwebConfigured = () =>
  Boolean(
    process.env.ASSETWEB_SERVICE_USER && process.env.ASSETWEB_SERVICE_PASSWORD
  )

/** 財產 (property, NT$10,000 or more) or 非消耗品 (non-consumables,
 * NT$6,000 to 10,000): the property system keeps them in two books. */
export type AssetKind = "property" | "nonconsumable"

const books: Record<AssetKind, { bean: string; page: string }> = {
  property: { bean: "ppt.ppt0195.PPT0195Do", page: "PPT/PPT0195Tab1.jsp" },
  nonconsumable: {
    bean: "ncs.ncs0195.NCS0195Do",
    page: "NCS/NCS0195Tab1.jsp",
  },
}

export type Asset = {
  kind: AssetKind
  /** 財產編號, e.g. 3100508-040 */
  id: string
  /** 財產分號 */
  no: string
  name: string
  alias: string
  brand: string
  model: string
  quantity: number
  unit: string
  /** 總價, NT$ */
  cost: number
  /** 帳面價值, NT$ */
  bookValue: number
  /** YYYY-MM-DD */
  acquiredOn: string | null
  usefulYears: number
  keeper: string
  user: string
  location: string
  note: string
}

type Row = Record<string, string | number | null | undefined>

const text = (value: Row[string]) => String(value ?? "").trim()

/** "107.12.01" (ROC year) -> "2018-12-01". */
function rocDate(value: Row[string]) {
  const match = /^(\d{2,3})\.(\d{2})\.(\d{2})$/.exec(text(value))
  if (!match) return null
  return `${Number(match[1]) + 1911}-${match[2]}-${match[3]}`
}

function asset(kind: AssetKind, row: Row): Asset {
  return {
    kind,
    id: text(row.ppt_id),
    no: text(row.ppt_no),
    name: text(row.ppt_name),
    alias: text(row.mov_alias),
    brand: text(row.mov_brand),
    model: text(row.mov_spec),
    quantity: Number(row.mov_qty ?? 0),
    unit: text(row.mov_unit),
    cost: Number(row.mov_amt ?? 0),
    bookValue: Number(row.mov_bookamt ?? 0),
    acquiredOn: rocDate(row.mov_getdt),
    usefulYears: Number(row.mov_year ?? 0),
    keeper: text(row.emp_name),
    user: text(row.use_empname),
    location: text(row.mov_sloc),
    note: text(row.mov_note || row.mov_memo),
  }
}

async function signIn() {
  const account = process.env.ASSETWEB_SERVICE_USER
  const password = process.env.ASSETWEB_SERVICE_PASSWORD
  if (!account || !password) throw new Error("財產系統帳號沒有設定")
  const response = await fetch(`${base()}/LoginAction`, {
    method: "POST",
    headers: {
      ...browser,
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      origin: base(),
      referer: `${base()}/login.jsp`,
    },
    body: new URLSearchParams({ whichsys: "PPT", account, password }),
    redirect: "manual",
    signal: timeout(),
  })
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .find((value) => value.startsWith("JSESSIONID="))
  const body = (await response.json().catch(() => null)) as {
    success?: boolean
    msg?: string
  } | null
  if (!body?.success || !cookie)
    throw new Error(
      `財產系統登入失敗${body?.msg ? `：${body.msg}` : `（${response.status}）`}`
    )
  return cookie
}

const PAGE = 500

async function readBook(cookie: string, kind: AssetKind): Promise<Asset[]> {
  const { bean, page } = books[kind]
  const rows: Row[] = []
  for (let start = 0; ; start += PAGE) {
    const response = await fetch(
      `${base()}/ActionServlet?bean=${bean}&action=G&a_id=&p_id=`,
      {
        method: "POST",
        headers: {
          ...browser,
          cookie,
          "content-type": "application/x-www-form-urlencoded",
          referer: `${base()}/${page}`,
        },
        // rpt_type 1 is 未減損: what is still on the books.
        body: new URLSearchParams({
          limit: String(PAGE),
          start: String(start),
          rpt_order: "1",
          rpt_type: "1",
        }),
        cache: "no-store",
        signal: timeout(),
      }
    )
    const body = (await response.json().catch(() => null)) as {
      success?: boolean
      msg?: string
      rows?: Row[]
      total?: number
    } | null
    if (!body?.success)
      throw new Error(
        `財產系統沒有回傳資料${body?.msg ? `：${body.msg}` : `（${response.status}）`}`
      )
    rows.push(...(body.rows ?? []))
    if (!body.rows?.length || rows.length >= (body.total ?? 0)) break
  }
  return rows.map((row) => asset(kind, row))
}

async function fetchAssets(): Promise<Asset[]> {
  const cookie = await signIn()
  const [property, nonconsumable] = await Promise.all([
    readBook(cookie, "property"),
    readBook(cookie, "nonconsumable"),
  ])
  return [...property, ...nonconsumable]
}

// Property changes a few times a year: ten minutes spares the account a
// sign-in on every page view. Callers share one request in flight.
let cache: { at: number; assets: Promise<Asset[]> } | null = null
const CACHE_MS = 10 * 60_000

/** Everything the account keeps, both books, still on the books. */
export function listAssets(fresh = false): Promise<Asset[]> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.assets
  const assets = fetchAssets()
  cache = { at: Date.now(), assets }
  assets.catch(() => {
    if (cache?.assets === assets) cache = null
  })
  return assets
}
