"""What a round is called.

A match is referred to by its id everywhere a person can see it — the ledger's
`Match` column, a tool response, a log line, an agent passing `match_id` back
into `join_match` — and `secrets.token_urlsafe(9)` gave all of those something
nobody can read out loud, remember, or check against somebody else's screenshot.

So the id IS the name: three words, the way `tollbooth-shortlinks` names a
link. There is no second identifier and no display column, because two names
for one round is two things to keep in step.

The trade is entropy. Three words out of these lists is about half a million
rounds rather than 2**72, which is fine for a name that is not a secret — the
lobby lists every open match — but NOT fine for a primary key taken on faith:
`open_match` inserts on conflict and picks again, and must keep doing so.
"""

from __future__ import annotations

import secrets

# Lifted from tollbooth-shortlinks, deliberately: a reader who has seen one of
# these slugs should recognise the other as the same kind of thing.
_ADJECTIVES = [
    "bold", "brave", "bright", "calm", "clever", "cool", "crisp", "dark",
    "eager", "fair", "fast", "fierce", "fine", "fond", "free", "fresh",
    "glad", "gold", "grand", "great", "green", "happy", "keen", "kind",
    "light", "lucky", "mild", "neat", "noble", "plain", "proud", "quick",
    "quiet", "rare", "red", "rich", "safe", "sharp", "shy", "silver",
    "sleek", "slim", "slow", "smart", "smooth", "soft", "steady", "still",
    "strong", "sunny", "sure", "sweet", "swift", "tall", "tame", "thin",
    "true", "vast", "warm", "white", "wide", "wild", "wise", "young",
]

_NOUNS = [
    "ant", "ape", "bass", "bat", "bear", "bee", "bird", "boar", "cat",
    "clam", "cod", "colt", "cow", "crab", "crow", "dart", "deer", "doe",
    "dog", "dove", "duck", "eagle", "eel", "elk", "elm", "fawn", "fish",
    "fly", "fox", "frog", "gem", "goat", "hawk", "hare", "hen", "hog",
    "horse", "jade", "jay", "kite", "lamb", "lark", "leaf", "lynx",
    "mare", "mink", "mole", "moth", "mule", "newt", "oak", "orca",
    "otter", "owl", "ox", "palm", "pear", "pine", "plum", "pony",
    "quail", "ram", "raven", "reed", "robin", "rose", "sage", "seal",
    "shrew", "slug", "snail", "snake", "star", "swan", "toad", "trout",
    "vine", "vole", "wasp", "whale", "wolf", "wren", "yak",
]

_VERBS = [
    "asks", "bakes", "bears", "bends", "bites", "blows", "brings",
    "builds", "burns", "calls", "carves", "casts", "chases", "claims",
    "climbs", "counts", "crafts", "crosses", "cuts", "digs", "draws",
    "drinks", "drops", "eats", "faces", "falls", "feeds", "fills",
    "finds", "flies", "folds", "follows", "forges", "gains", "gets",
    "gives", "goes", "grabs", "grows", "guards", "guides", "has",
    "hears", "helps", "hides", "hits", "holds", "hunts", "joins",
    "jumps", "keeps", "knows", "leads", "learns", "lifts", "likes",
    "lives", "loves", "makes", "maps", "marks", "meets", "mends",
    "moves", "needs", "opens", "owns", "packs", "paints", "picks",
    "plants", "plays", "pulls", "reads", "rides", "rings", "rolls",
    "runs", "saves", "sees", "seeks", "sends", "sews", "shows",
    "sings", "sits", "spins", "takes", "tells", "ties", "tips",
    "tops", "tries", "turns", "walks", "wants", "watches", "wins",
]

#: How many distinct names exist. Named so a test can state the collision
#: argument rather than a reader having to multiply three list lengths.
SPACE = len(_ADJECTIVES) * len(_NOUNS) * len(_VERBS)


def round_name() -> str:
    """A name for a round, like ``swift-otter-digs``.

    `secrets` rather than `random`: not because the name is a secret, but
    because a process-wide seeded PRNG is the sort of thing that gets seeded
    for a test and then hands two workers the same name in production.
    """
    return "-".join([
        secrets.choice(_ADJECTIVES),
        secrets.choice(_NOUNS),
        secrets.choice(_VERBS),
    ])
