export interface Passage {
  id: string;
  text: string;
  wordCount: number;
  length: "short" | "medium" | "long";
}

function w(text: string): number {
  return text.trim().split(/\s+/).length;
}

function bucket(wordCount: number): Passage["length"] {
  if (wordCount <= 35) return "short";
  if (wordCount <= 70) return "medium";
  return "long";
}

const RAW: Array<{ id: string; text: string }> = [
  {
    id: "fox",
    text: "The quick brown fox jumps over the lazy dog near the riverbank while the sun sets behind the hills.",
  },
  {
    id: "coffee",
    text: "Coffee is best when it is simple: hot water, ground beans, and a small amount of patience. The ritual matters almost as much as the drink itself.",
  },
  {
    id: "engineer",
    text: "A good engineer writes code that a future stranger can read without asking questions. A great engineer writes code that the future stranger does not need to change at all.",
  },
  {
    id: "trains",
    text: "Late trains have their own peculiar quiet. The platform empties out, the announcements fade, and the only sound left is the wind pulling loose pages across the tiles.",
  },
  {
    id: "keyboard",
    text: "Typing fast is not really about the fingers. It is about trusting that the word in your head will arrive on the screen without you having to watch each letter land.",
  },
  {
    id: "city",
    text: "The city never sleeps, but it does take naps. Between three and four in the morning, the traffic lights blink at no one, and the streets belong to delivery drivers and foxes.",
  },
  {
    id: "habits",
    text: "Small habits compound into large outcomes, and most of the people who look like they are winning in life are just people who picked a direction and refused to get bored.",
  },
  {
    id: "ocean",
    text: "The ocean does not care about your plans. It moves on its own schedule, pulling things out and pushing things back, and whatever you built on the sand was always temporary.",
  },
  {
    id: "internet",
    text: "The early internet promised that information wanted to be free, and it mostly is, but it turns out that was never the hard part. The hard part was deciding which information was worth paying attention to.",
  },
  {
    id: "friendship",
    text: "A good friendship survives long silences. You can go six months without a text and still pick up the conversation exactly where you left it, as if no time had passed at all, which in some strange way is true.",
  },
];

export const PASSAGES: Passage[] = RAW.map((p) => {
  const wordCount = w(p.text);
  return { ...p, wordCount, length: bucket(wordCount) };
});

export function randomPassage(exclude?: string): Passage {
  const pool = exclude
    ? PASSAGES.filter((p) => p.id !== exclude)
    : PASSAGES;
  return pool[Math.floor(Math.random() * pool.length)];
}
