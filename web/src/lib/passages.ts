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
  if (wordCount <= 20) return "short";
  if (wordCount <= 45) return "medium";
  return "long";
}

const RAW: Array<{ id: string; text: string }> = [
  {
    id: "train_left_early",
    text: "the train left early but nobody seemed surprised",
  },
  {
    id: "rain_parking_lot",
    text: "we ran across the parking lot laughing at the rain",
  },
  {
    id: "final_corner",
    text: "every shortcut worked until the final corner",
  },
  {
    id: "timer_kept_ticking",
    text: "the timer kept ticking while both players made mistakes",
  },
  {
    id: "quiet_bus",
    text: "the bus was quiet except for one song leaking from old headphones",
  },
  {
    id: "open_window",
    text: "someone left the window open and the whole room smelled like rain",
  },
  {
    id: "lost_keys",
    text: "my keys were exactly where i checked three times before",
  },
  {
    id: "streetlights",
    text: "the streetlights turned on before the sky admitted it was evening",
  },
  {
    id: "late_snack",
    text: "a late snack tastes better when everyone else is asleep",
  },
  {
    id: "fast_start",
    text: "he started fast then slowed down when the easy words disappeared",
  },
  {
    id: "blue_hoodie",
    text: "the blue hoodie was still warm from sitting in the sun",
  },
  {
    id: "forgotten_charger",
    text: "the charger was forgotten at home right when the battery turned red",
  },
  {
    id: "small_habits",
    text: "small habits turn into big results when nobody is watching closely",
  },
  {
    id: "empty_platform",
    text: "the platform emptied out while the delayed train kept changing tracks",
  },
  {
    id: "weekend_plan",
    text: "the weekend plan changed five times and somehow became better each time",
  },
  {
    id: "coffee_line",
    text: "the coffee line moved slowly because everyone had a complicated order",
  },
  {
    id: "quiet_competition",
    text: "the race felt friendly until the last few words became serious",
  },
  {
    id: "midnight_store",
    text: "the midnight store had one tired cashier and a radio playing softly",
  },
  {
    id: "weather_app",
    text: "the weather app promised sunshine but the clouds arrived with confidence",
  },
  {
    id: "shared_screen",
    text: "everyone leaned toward the shared screen when the race got close",
  },
  {
    id: "city_morning",
    text: "the city woke up slowly with delivery trucks rolling past closed shops while one runner crossed every street before the lights could change and a bakery door opened early",
  },
  {
    id: "practice_round",
    text: "the first practice round felt awkward but the second one made the keyboard sound like it belonged to someone faster and the third one made everyone lean closer",
  },
  {
    id: "borrowed_bike",
    text: "she borrowed the old bike for one quick errand and came back with groceries flowers and a story about a dog that followed her home for six blocks",
  },
  {
    id: "group_chat",
    text: "the group chat went silent for a full minute while everyone watched the two racers trade the lead near the end and nobody wanted to break the spell",
  },
  {
    id: "open_tabs",
    text: "too many open tabs made the laptop feel busy even though the only thing that mattered was the sentence on the screen and the next clean word",
  },
  {
    id: "library_table",
    text: "at the library table nobody spoke above a whisper but every backpack zipper sounded like someone tearing paper in half during the quietest part of the afternoon",
  },
  {
    id: "night_drive",
    text: "the night drive felt longer than expected because the same three songs kept returning and every gas station looked closed until the road curved toward home",
  },
  {
    id: "close_match",
    text: "a close match changes how people sit in their chairs because suddenly every typo feels personal every clean word feels loud and the last line looks longer",
  },
  {
    id: "kitchen_light",
    text: "the kitchen light buzzed while noodles boiled and someone tried to explain a movie plot from memory without remembering the ending or any of the names",
  },
  {
    id: "old_notebook",
    text: "an old notebook fell open to a page full of plans that once felt urgent and now looked like messages from a different person who had more energy than proof and more ideas than time but the handwriting still made the whole thing feel possible again so the page stayed on the desk while new plans formed slowly around the old ones",
  },
  {
    id: "long_walk_home",
    text: "the long walk home started as a shortcut and turned into a slow tour of quiet streets closed stores porch lights and the smell of someone cooking dinner nearby while a bus hissed at the corner and three friends argued about which way would have been faster if anyone had checked the map before leaving instead of trusting the loudest person in the group",
  },
  {
    id: "airport_delay",
    text: "the flight delay made strangers act like a temporary neighborhood as people guarded bags shared outlets watched the same gate screen and pretended not to listen to every announcement while children slept across plastic chairs and someone kept refreshing the weather as if patience could change the sky or convince the plane to appear sooner at the end of the glass hallway",
  },
  {
    id: "morning_routine",
    text: "every morning had the same small race between the alarm the shower the missing socks and the hope that traffic would be kinder than yesterday but the kitchen clock always seemed to move faster after coffee and slower before shoes were found while the phone buzzed with reminders that somehow felt both helpful and rude",
  },
  {
    id: "arcade_memory",
    text: "the old arcade had sticky floors dim lights and one racing game that made everyone lean sideways even though the cabinet never moved at all and the same champion initials stayed on the screen for years like a local legend nobody could prove until one summer afternoon when a quiet kid beat the record and walked away before anyone learned his name",
  },
  {
    id: "storm_window",
    text: "rain hit the window so hard that the room felt smaller and everyone stopped pretending to work for a moment just to watch the street shine while cars moved slowly through reflections and the thunder arrived late like it had been thinking about what to say before shaking the walls and sending everyone back to their screens with better posture",
  },
  {
    id: "last_page",
    text: "the last page of the book arrived too quickly and left behind the strange quiet that happens when a good story ends before you are ready so the cover stayed open on the table while the room returned piece by piece to normal and every small sound felt like an interruption from a less interesting world",
  },
  {
    id: "shared_playlist",
    text: "the shared playlist kept jumping from calm songs to loud ones and somehow that made the whole drive feel like a conversation nobody had to finish because every chorus changed the mood and every quiet song made the headlights feel farther apart while the road kept unfolding in front of them like it knew the way home",
  },
  {
    id: "rooftop_evening",
    text: "the rooftop evening began with someone carrying folding chairs up the stairs and ended with everyone watching clouds turn orange over the apartments while music played from a small speaker that kept cutting out whenever a phone notification arrived and nobody cared because the view made every delay feel like part of the plan",
  },
  {
    id: "museum_room",
    text: "the museum room was quiet enough to hear shoes on the floor and every painting seemed to be waiting for someone patient to stop rushing past it so a group of friends picked their favorite one and argued softly about colors shapes hidden details and whether the artist had meant any of it",
  },
  {
    id: "bus_window",
    text: "from the bus window the city looked like a moving game board with people crossing sidewalks bikes slipping between cars and shop signs turning into streaks whenever the driver pulled away too quickly while the passenger in the back tried to finish one message before the next stop arrived",
  },
  {
    id: "weekend_project",
    text: "the weekend project started with one simple idea and became a table covered in wires tape empty cups and notes written on the backs of envelopes while everyone claimed they were almost done even though the hardest part had not appeared until the room was already messy",
  },
  {
    id: "snow_day",
    text: "the snow day made the whole neighborhood slower as cars disappeared under white roofs and kids dragged sleds toward the hill while adults stood in doorways pretending to check the weather but really watching the street become quiet enough to hear laughter from two blocks away",
  },
  {
    id: "movie_night",
    text: "movie night took longer to begin than the movie itself because everyone had a different suggestion and every trailer reminded someone of another option until the snacks were half gone the couch was full and the final choice won mostly because nobody had the energy to argue anymore",
  },
  {
    id: "market_morning",
    text: "the market morning smelled like bread peaches rain on pavement and coffee from a cart near the entrance where people formed a crooked line while vendors stacked crates counted change called out prices and somehow remembered regular customers who only appeared once a week",
  },
  {
    id: "close_finish",
    text: "near the end of the race both players stopped blinking as the words became shorter and the lead changed twice in a single line while the spectators watched the cursors move like tiny signals across the sentence and waited for one final mistake to decide everything",
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
