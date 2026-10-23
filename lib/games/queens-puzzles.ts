// 100 Queens puzzles, all with unique solutions, generated offline.
// Encoding: regions = N*N row-major region ids (digits 0-9, but max is size-1
// so 0-6 for our largest 7×7); queens = N column indices, row i → col queens[i].
// Sizes: 1到30 = 5×5, 31到60 = 6×6, 61到100 = 7×7.

export interface QueensPuzzle {
  level: number
  size: number
  regions: number[][]
  queens: number[]
}

interface EncodedPuzzle {
  level: number
  size: number
  regions: string
  queens: string
}

const ENCODED: EncodedPuzzle[] = [
  { level: 1, size: 5, regions: "1100211002114423144211442", queens: "31402" },
  { level: 2, size: 5, regions: "1110011133241334433344433", queens: "42031" },
  { level: 3, size: 5, regions: "0000220112222223322233442", queens: "02413" },
  { level: 4, size: 5, regions: "1100011020440203444434444", queens: "41302" },
  { level: 5, size: 5, regions: "2000022100223332223344433", queens: "42031" },
  { level: 6, size: 5, regions: "2000020001220032443324443", queens: "24031" },
  { level: 7, size: 5, regions: "1004410044102241344433444", queens: "20314" },
  { level: 8, size: 5, regions: "0001122111222113333343333", queens: "24130" },
  { level: 9, size: 5, regions: "1110011100112234444344443", queens: "30241" },
  { level: 10, size: 5, regions: "1100011000142331433344333", queens: "30241" },
  { level: 11, size: 5, regions: "1110011100112004423344443", queens: "30241" },
  { level: 12, size: 5, regions: "0000001111021134411344443", queens: "03142" },
  { level: 13, size: 5, regions: "1100011100221302233344333", queens: "42031" },
  { level: 14, size: 5, regions: "1110211122112223112233422", queens: "31402" },
  { level: 15, size: 5, regions: "0000000010200102333033334", queens: "13024" },
  { level: 16, size: 5, regions: "1000211122133221333343333", queens: "31420" },
  { level: 17, size: 5, regions: "1111021111221112223124333", queens: "42031" },
  { level: 18, size: 5, regions: "1120011222112224122344433", queens: "30241" },
  { level: 19, size: 5, regions: "0111111111424114444344443", queens: "03142" },
  { level: 20, size: 5, regions: "0022211122333223334234444", queens: "02413" },
  { level: 21, size: 5, regions: "1110011110411124332244222", queens: "31420" },
  { level: 22, size: 5, regions: "2200022031200330003344033", queens: "24031" },
  { level: 23, size: 5, regions: "1110011003422334433344333", queens: "30241" },
  { level: 24, size: 5, regions: "2200122231222332233343333", queens: "24130" },
  { level: 25, size: 5, regions: "0011102111421134441344433", queens: "03142" },
  { level: 26, size: 5, regions: "0021132221322223324444444", queens: "14203" },
  { level: 27, size: 5, regions: "0012231122313223334244444", queens: "02413" },
  { level: 28, size: 5, regions: "0000011003112334113344433", queens: "30241" },
  { level: 29, size: 5, regions: "2021122211222213221144444", queens: "14203" },
  { level: 30, size: 5, regions: "1100211222442334443344443", queens: "30241" },
  {
    level: 31,
    size: 6,
    regions: "002222011222332222332222344445334555",
    queens: "024135",
  },
  {
    level: 32,
    size: 6,
    regions: "111100111100111120311224314444354444",
    queens: "524031",
  },
  {
    level: 33,
    size: 6,
    regions: "100022100222333224333324333444554444",
    queens: "304251",
  },
  {
    level: 34,
    size: 6,
    regions: "110222111222132222133324133444333345",
    queens: "204135",
  },
  {
    level: 35,
    size: 6,
    regions: "001222301222332222332224333244335544",
    queens: "024153",
  },
  {
    level: 36,
    size: 6,
    regions: "100000110000144002334402444445444455",
    queens: "315024",
  },
  {
    level: 37,
    size: 6,
    regions: "111102111122111132433333443333445333",
    queens: "415302",
  },
  {
    level: 38,
    size: 6,
    regions: "031111331111322241333444333444355444",
    queens: "053142",
  },
  {
    level: 39,
    size: 6,
    regions: "000000000122004222034442444444445544",
    queens: "035142",
  },
  {
    level: 40,
    size: 6,
    regions: "000222110022112222122223442223444455",
    queens: "203514",
  },
  {
    level: 41,
    size: 6,
    regions: "222000222110222211223333444433544443",
    queens: "531420",
  },
  {
    level: 42,
    size: 6,
    regions: "200014203114233144533444555544555544",
    queens: "140253",
  },
  {
    level: 43,
    size: 6,
    regions: "021111021111221133443333444433444435",
    queens: "031425",
  },
  {
    level: 44,
    size: 6,
    regions: "111102511122531112531144555444555444",
    queens: "425130",
  },
  {
    level: 45,
    size: 6,
    regions: "011111111122113322144352444352444552",
    queens: "025314",
  },
  {
    level: 46,
    size: 6,
    regions: "011111211111224411244453444453444455",
    queens: "031524",
  },
  {
    level: 47,
    size: 6,
    regions: "033333333331332222333224333444355554",
    queens: "053142",
  },
  {
    level: 48,
    size: 6,
    regions: "202211222211222211242331444331445511",
    queens: "152403",
  },
  {
    level: 49,
    size: 6,
    regions: "110000111111112411344441344444555544",
    queens: "352041",
  },
  {
    level: 50,
    size: 6,
    regions: "000000111000113022333022433225333225",
    queens: "314205",
  },
  {
    level: 51,
    size: 6,
    regions: "001111000111222111322141224445224555",
    queens: "142035",
  },
  {
    level: 52,
    size: 6,
    regions: "021111222133222133222233444445444445",
    queens: "031425",
  },
  {
    level: 53,
    size: 6,
    regions: "000111000111244411444433444445444445",
    queens: "130425",
  },
  {
    level: 54,
    size: 6,
    regions: "021111222111222211222233224553224553",
    queens: "031524",
  },
  {
    level: 55,
    size: 6,
    regions: "002211333211333222333322334442344552",
    queens: "153024",
  },
  {
    level: 56,
    size: 6,
    regions: "112202122222122244132244335444335444",
    queens: "403152",
  },
  {
    level: 57,
    size: 6,
    regions: "100022110022110422334422444452445552",
    queens: "315024",
  },
  {
    level: 58,
    size: 6,
    regions: "311400311422331442533444554444555544",
    queens: "425130",
  },
  {
    level: 59,
    size: 6,
    regions: "111110111113421133441133444443554443",
    queens: "531420",
  },
  {
    level: 60,
    size: 6,
    regions: "022221222221222222243332445555445555",
    queens: "052413",
  },
  {
    level: 61,
    size: 7,
    regions: "1111000111122211112221115322144552244455526444444",
    queens: "5264130",
  },
  {
    level: 62,
    size: 7,
    regions: "1000000100000011203334444333444443344445564444446",
    queens: "3025146",
  },
  {
    level: 63,
    size: 7,
    regions: "1100004110222411122245553244555524455552446655544",
    queens: "4153620",
  },
  {
    level: 64,
    size: 7,
    regions: "0011111201111120111112244435266443566645556666666",
    queens: "1405362",
  },
  {
    level: 65,
    size: 7,
    regions: "0222211222222122242312244433224444455554445566666",
    queens: "0625314",
  },
  {
    level: 66,
    size: 7,
    regions: "1110000111110311112031111103441110344555536555555",
    queens: "5246130",
  },
  {
    level: 67,
    size: 7,
    regions: "0331122332212233222224333332443333344333534466553",
    queens: "0463152",
  },
  {
    level: 68,
    size: 7,
    regions: "1333330133333333332223333344555534455554445556666",
    queens: "6042513",
  },
  {
    level: 69,
    size: 7,
    regions: "1111110111111041111224431222445155244555554655555",
    queens: "6352041",
  },
  {
    level: 70,
    size: 7,
    regions: "1000000103000013300203333500444550046665506666555",
    queens: "6053142",
  },
  {
    level: 71,
    size: 7,
    regions: "2202221222222122222224222233466222246655226666555",
    queens: "2635041",
  },
  {
    level: 72,
    size: 7,
    regions: "2200211222221122222113335555364555536665556666555",
    queens: "3640251",
  },
  {
    level: 73,
    size: 7,
    regions: "0000111000011142211114443111444441144445554445556",
    queens: "2513046",
  },
  {
    level: 74,
    size: 7,
    regions: "4221100422111344222134422233444423344455336445533",
    queens: "6425130",
  },
  {
    level: 75,
    size: 7,
    regions: "1001222111122213222223332242332244433555443666555",
    queens: "1350642",
  },
  {
    level: 76,
    size: 7,
    regions: "0000011020001122200012223031222333452233345266664",
    queens: "2513604",
  },
  {
    level: 77,
    size: 7,
    regions: "1111000111130011113321133333463333366553336655533",
    queens: "5264031",
  },
  {
    level: 78,
    size: 7,
    regions: "2221110622213366222334662333466235566555556665555",
    queens: "6425031",
  },
  {
    level: 79,
    size: 7,
    regions: "3333011333331122233112243331444433156643315663333",
    queens: "4615302",
  },
  {
    level: 80,
    size: 7,
    regions: "1114330211433324443334444333444433344555664556666",
    queens: "6204135",
  },
  {
    level: 81,
    size: 7,
    regions: "0022222111222211222224166233446665344666556666665",
    queens: "0246153",
  },
  {
    level: 82,
    size: 7,
    regions: "0332111332221133324443334444334444455554445555446",
    queens: "0531426",
  },
  {
    level: 83,
    size: 7,
    regions: "1101111111111311323334433333444433344443554444655",
    queens: "2035164",
  },
  {
    level: 84,
    size: 7,
    regions: "1111100111130011113221113333444443355444465666666",
    queens: "5164203",
  },
  {
    level: 85,
    size: 7,
    regions: "0000222301122233222423332244332244432254443225446",
    queens: "0241536",
  },
  {
    level: 86,
    size: 7,
    regions: "0000222110022211022221522423555546355554665555466",
    queens: "2036415",
  },
  {
    level: 87,
    size: 7,
    regions: "0033333001333200133224433332444335555555555555556",
    queens: "0253146",
  },
  {
    level: 88,
    size: 7,
    regions: "2211100222311122233332225333445555364555556455555",
    queens: "6425130",
  },
  {
    level: 89,
    size: 7,
    regions: "0221114222114422211442255344225544455554445555466",
    queens: "0314625",
  },
  {
    level: 90,
    size: 7,
    regions: "0011111211111321113331111133114333311433351144666",
    queens: "1305264",
  },
  {
    level: 91,
    size: 7,
    regions: "0011333111333311133323333334533344455566665556666",
    queens: "0263514",
  },
  {
    level: 92,
    size: 7,
    regions: "2220000222000122223332444333244443354444445546444",
    queens: "4615203",
  },
  {
    level: 93,
    size: 7,
    regions: "2230011233331123333333333333533334455444445566444",
    queens: "4602513",
  },
  {
    level: 94,
    size: 7,
    regions: "0221111222441122444132444333244465344666534666666",
    queens: "0614253",
  },
  {
    level: 95,
    size: 7,
    regions: "0011111001111420111142553514555554455554445555446",
    queens: "1403526",
  },
  {
    level: 96,
    size: 7,
    regions: "3300004330011433221443333344333344453366443333644",
    queens: "2531604",
  },
  {
    level: 97,
    size: 7,
    regions: "0222222044222104422223344422344442244444554466455",
    queens: "0641352",
  },
  {
    level: 98,
    size: 7,
    regions: "2000000220000122230312223333444333344453336455333",
    queens: "4625130",
  },
  {
    level: 99,
    size: 7,
    regions: "1000033110003311203334140336444053644445564444666",
    queens: "3025146",
  },
  {
    level: 100,
    size: 7,
    regions: "2222210222111022213332233333244433355633335663333",
    queens: "6415302",
  },
]

function decode(enc: EncodedPuzzle): QueensPuzzle {
  const regions: number[][] = []
  for (let r = 0; r < enc.size; r++) {
    const row: number[] = []
    for (let c = 0; c < enc.size; c++) {
      row.push(Number(enc.regions[r * enc.size + c]))
    }
    regions.push(row)
  }
  const queens: number[] = []
  for (let r = 0; r < enc.size; r++) queens.push(Number(enc.queens[r]))
  return { level: enc.level, size: enc.size, regions, queens }
}

export const QUEENS_LEVEL_COUNT = ENCODED.length

export function getQueensPuzzle(level: number): QueensPuzzle {
  const clamped = Math.max(1, Math.min(QUEENS_LEVEL_COUNT, level | 0))
  return decode(ENCODED[clamped - 1]!)
}
