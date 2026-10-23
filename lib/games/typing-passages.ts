// Typing passages, grouped by language. Each language is a "level" in
// game_scores so each one keeps its own leaderboard (English vs 繁中 vs … are
// not directly comparable，different units, different keyboards).

export interface TypingLanguage {
  id: number
  label: string
  code: "en" | "zh-Hant" | "de" | "fr" | "it" | "es"
  passages: string[]
}

export const TYPING_LANGUAGES: TypingLanguage[] = [
  {
    id: 0,
    label: "English",
    code: "en",
    passages: [
      "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump.",
      "Programming is the art of telling another human what one wants the computer to do. Clean code always looks like it was written by someone who cares.",
      "Science is not only a disciple of reason but also one of romance and passion. The universe is under no obligation to make sense to you.",
      "Imagination is more important than knowledge. Knowledge is limited, but imagination embraces the entire world, stimulating progress and giving birth to evolution.",
      "Success is not final, failure is not fatal: it is the courage to continue that counts. Never give in, never give in, never, never, never.",
      "The only way to do great work is to love what you do. If you have not found it yet, keep looking and do not settle, just as in any matter of the heart.",
      "Two roads diverged in a yellow wood, and sorry I could not travel both. I took the one less traveled by, and that has made all the difference.",
      "We choose to go to the moon in this decade and do the other things, not because they are easy, but because they are hard, and the challenge is one we are willing to accept.",
      "Be the change that you wish to see in the world. In a gentle way, you can shake the world by living your truth with patience and quiet determination.",
      "The best time to plant a tree was twenty years ago. The second best time is now, so stop waiting for the perfect moment and just begin.",
    ],
  },
  {
    id: 1,
    label: "繁體中文",
    code: "zh-Hant",
    passages: [
      "千里之行，始於足下。九層之台，起於累土。天行健，君子以自強不息。",
      "學而時習之，不亦說乎。有朋自遠方來，不亦樂乎。人不知而不慍，不亦君子乎。",
      "海內存知己，天涯若比鄰。無為在歧路，兒女共沾巾。莫愁前路無知己，天下誰人不識君。",
      "知之為知之，不知為不知，是知也。學而不思則罔，思而不學則殆。三人行，必有我師焉。",
      "鍥而不舍，金石可鏤。不積跬步，無以至千里。不積小流，無以成江海。",
      "落霞與孤鶩齊飛，秋水共長天一色。漁舟唱晚，響窮彭蠡之濱。雁陣驚寒，聲斷衡陽之浦。",
      "山不在高，有仙則名。水不在深，有龍則靈。斯是陋室，惟吾德馨。",
      "山重水複疑無路，柳暗花明又一村。莫笑農家臘酒渾，豐年留客足雞豚。",
      "舉頭望明月，低頭思故鄉。床前明月光，疑是地上霜。月落烏啼霜滿天，江楓漁火對愁眠。",
      "問渠那得清如許，為有源頭活水來。半畝方塘一鑑開，天光雲影共徘徊。",
    ],
  },
  {
    id: 2,
    label: "Deutsch",
    code: "de",
    passages: [
      "Der frühe Vogel fängt den Wurm, doch der zweite bekommt den Käse. Wer rastet, der rostet.",
      "Wer den Pfennig nicht ehrt, ist des Talers nicht wert. Übung macht den Meister, sagt das Sprichwort.",
      "Geteiltes Leid ist halbes Leid, geteilte Freude ist doppelte Freude. Was Hänschen nicht lernt, lernt Hans nimmermehr.",
      "Aller Anfang ist schwer, doch wer am Ball bleibt, kommt ans Ziel. Ohne Fleiß kein Preis, sagt man im Deutschen.",
      "Es ist nicht alles Gold, was glänzt, und nicht jeder Schein trügt nicht. Vertraue, aber prüfe.",
      "Reden ist Silber, Schweigen ist Gold. Doch im richtigen Moment ist das richtige Wort unbezahlbar.",
      "Man soll den Tag nicht vor dem Abend loben. Wer zuletzt lacht, lacht am besten.",
      "Der Apfel fällt nicht weit vom Stamm, aber manchmal rollt er erstaunlich weit den Hang hinunter.",
      "Wo ein Wille ist, ist auch ein Weg. Wer kämpft, kann verlieren，wer nicht kämpft, hat schon verloren.",
      "Die Hoffnung stirbt zuletzt, sagt das Sprichwort. Solange wir leben, ist nichts wirklich verloren.",
    ],
  },
  {
    id: 3,
    label: "Français",
    code: "fr",
    passages: [
      "Un voyage de mille lieues commence toujours par un premier pas, dit le proverbe le plus connu.",
      "Tous pour un, un pour tous, voilà notre devise. L'union fait la force, telle est notre conviction.",
      "Bien faire et laisser dire, voilà la sagesse la plus simple du monde. À cœur vaillant rien d'impossible.",
      "Petit à petit, l'oiseau fait son nid. La patience est mère de toutes les vertus, dit-on souvent.",
      "Qui sème le vent récolte la tempête. Chaque action porte en elle ses propres conséquences, tôt ou tard.",
      "Mieux vaut tard que jamais, mais jamais en retard, c'est encore mieux. Le temps perdu ne se rattrape jamais.",
      "Quand on veut, on peut. La volonté déplace les montagnes, à condition de ne pas baisser les bras.",
      "Il n'y a pas de fumée sans feu. Derrière chaque rumeur se cache souvent une part de vérité dérangeante.",
      "La nuit porte conseil, dit le vieux proverbe français. Avant toute décision importante, mieux vaut dormir dessus.",
      "L'habit ne fait pas le moine, et l'apparence trompe souvent. Ne jugez jamais un livre à sa couverture.",
    ],
  },
  {
    id: 4,
    label: "Italiano",
    code: "it",
    passages: [
      "Chi va piano va sano e va lontano, dice un antico proverbio italiano molto saggio.",
      "Ogni medaglia ha il suo rovescio, e ogni successo nasconde una caduta. La fortuna aiuta gli audaci.",
      "Tra il dire e il fare c'è di mezzo il mare, ricordatelo sempre. Chi cerca trova, chi domanda intende.",
      "Roma non fu costruita in un giorno, e nemmeno i grandi sogni si realizzano in una notte. Ci vuole pazienza.",
      "Chi dorme non piglia pesci, dice il proverbio. Ma chi corre troppo veloce inciampa sui propri piedi.",
      "L'erba del vicino è sempre più verde, ma il prato del giardino di casa va comunque innaffiato ogni giorno.",
      "Meglio un uovo oggi che una gallina domani. La certezza del presente vale più della speranza nel futuro.",
      "Tutte le strade portano a Roma, ma non tutte arrivano con la stessa velocità. Scegli la tua con cura.",
      "Non si può avere la botte piena e la moglie ubriaca. Ogni scelta comporta inevitabilmente una rinuncia.",
      "Chi trova un amico trova un tesoro, dice un detto antico. L'amicizia vera è il vero capitale della vita.",
    ],
  },
  {
    id: 5,
    label: "Español",
    code: "es",
    passages: [
      "El que persevera alcanza, y quien madruga encuentra el camino abierto al éxito.",
      "Más vale tarde que nunca, pero también vale más nunca tarde, dice el refrán antiguo.",
      "Camarón que se duerme se lo lleva la corriente. No por mucho madrugar amanece más temprano.",
      "A caballo regalado no se le mira el diente, aunque a veces conviene revisar antes de aceptar.",
      "En boca cerrada no entran moscas, dice la sabiduría popular. A veces el silencio vale más que mil palabras.",
      "No hay mal que por bien no venga, aunque cueste verlo en el momento. El tiempo siempre acaba revelando el sentido.",
      "Quien siembra vientos recoge tempestades, y quien planta paciencia cosecha frutos dulces durante toda la vida.",
      "Ojos que no ven, corazón que no siente. La distancia, sin embargo, también puede hacer crecer el cariño verdadero.",
      "A mal tiempo, buena cara, dice el refrán español. La actitud es la única cosa que realmente podemos elegir cada día.",
      "Más vale prevenir que curar, en la vida como en la salud. Las pequeñas precauciones evitan grandes problemas.",
    ],
  },
]

export function getTypingLanguage(id: number): TypingLanguage {
  return TYPING_LANGUAGES[id] ?? TYPING_LANGUAGES[0]!
}

// Used to compute WPM. English/European languages use whitespace-separated
// words; Chinese counts CJK characters since it has no word boundaries.
export function countUnits(text: string, code: TypingLanguage["code"]): number {
  if (code === "zh-Hant") {
    return [...text].filter((ch) => /[一-鿿]/.test(ch)).length
  }
  return text.trim().split(/\s+/).length
}
