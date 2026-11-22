[← All tutorials](../tutorials.md)

# Play Together Page

Play Together lets you play your games with other people: on the same Wi-Fi, over the internet, or even with no Wi-Fi around at all. Someone hosts a room, everyone else joins it, and CheevoDeck handles the netplay setup that normally takes a whole evening of forum posts. You can access the Play Together features in **Notifications** at the top or in **Utilities**.

## Pick a Play Mode

Every room uses one of three modes. Here's the short version of each, as well as the pros and cons:

| | **Link Play** | **Couch Play** | **Stream Play** |
|---|---|---|---|
| **Summary** | Simulates linking, such as Game Boy linking or network play between consoles. | Simulates playing one game on one TV together, except playing together remotely. | Like Couch Play, except the host streams the game; guests don't need a copy. |
| **Great for…** | Pokémon trading and simulating GameCube and Wii system linkups. | Games where multiple people played on one TV, such as Super Smash Bros., Mario Party, Secret of Mana, etc. | Games where multiple people played on one TV, such as Super Smash Bros., Mario Party, Secret of Mana, etc. |
| **Players** | 2-4 | 1-10 | 1-10 |
| **More Than One Player per Device?** | No; each device counts as one player. | No; each device counts as one player. | Yes; plug extra controllers into any device in the room, host or guest, and those players join in too. Each extra controller takes one of the game's player slots, so if the room already fills the game's player count, someone ends up only watching. |
| **Friend Needs a Copy?** | Yes; everyone needs a copy of the game. The guests' games can vary if supported, for games like Pokémon. Revision and hash don't need to match here. | Yes; everyone needs a copy of the game. The games must match exactly down to the hash and revision. For example, if the host is using a Rev 1 version of a game, the guest must have a matching revision. Uses RetroArch's netplay as well as standalone netplay. | No; the benefit here is only the host needs a copy of the game, while the guests do not need it. The game is streamed to them. |
| **Game Compatibility** | Limited; compatible with games that supported link multiplayer. Even then, the cores only support a limited handful of games. All linkable Pokémon games are supported, from Game Boy to Nintendo DS. | Moderate; almost all of your games should support Couch Play, as RetroArch drives most of it. Some standalone emulators like DuckStation and PCSX2 do not support this. That is where Stream Play steps in. | Full; every single game and emulator is supported. |
| **Achievement Hunting** | Yes; host and guests earn their own achievements with their own mode choice, provided the core supports it. Research whether your set plays nice with link trading/play first. | Yes; everyone earns achievements, but the host controls which mode (Hardcore or Softcore). No achievements for N64, due to RMG being required for netplay. | Only the host earns achievements. |
| **Single-Player Games?** | No; requires multiplayer link games for play. | Yes; guests can drop in and join any time while the host plays a single-player game. They can watch or even control the host's controls if enabled. | Yes; guests can drop in and join at any time while the host plays a single-player game, but can only watch. Similar to watching people stream. |
| **Benefits (Technical)** | Low bandwidth requirements for the host; feels native when playing. | Low bandwidth requirements for the host; feels native when playing; guests can join at any time after the host starts. | Highest compatibility; works with any game for any emulator; guests can join at any time after the host starts. |
| **Costs (Technical)** | Only a handful of games support link play. All players have to start around the same time. | Some RetroArch cores can stutter audio whenever RetroArch resyncs everyone's cores for netplay. Mostly resolved by CheevoDeck's recommended cores that reduce or don't have stuttering at all. | Requires the host to have a good internet connection, often requiring 10 Mbps upload per guest (Default - Online Requirements). Playing locally on a modern Wi-Fi network or Offline Hotspot costs next to nothing. |

The page shows each mode as **Ready**, **Needs setup** or **Won't work** for the game you've picked, so you can see at a glance which ones you can play right now.

**Ready** means you're good to go and can play that mode right now. **Needs setup** means something is missing, like an emulator, a core, a shortcut or the game's file, but press it and **Fix It** can almost always sort it out in one press, usually in seconds, or a minute or two when it has to download an emulator (see [When Something Needs Setup](#when-something-needs-setup) below). **Won't work** means that mode can't run that game at all, like a Wii game in Link Play, and pressing it tells you why.

## Hosting and Joining

**Host a Room** opens a window where you name your room and pick:

- **Players:** anywhere from 2 to 10.
- **Who Can Join:** **Public** rooms are open to anyone who finds them, **Friend Only** rooms only show to your Play Together friends and they get in without a password, and **Private** rooms need a password. Anyone you invite skips the password.
- **Local or Online:** Local rooms are for people on the same Wi-Fi. Online rooms go through the CheevoDeck lobby server, so your friends can be anywhere. A few games can only do Local, and the window lets you know when that's the case.
- **Voice Chat:** turn it on if you want to talk. Everyone starts with their mic muted.

To join, press **Find a Room**. Rooms on your own Wi-Fi show up first under **Local**, and online rooms show up under **Online**, 64 to a page, with **Previous Page** and **Next Page** both above and below the list. You can search by room name, game, host or status, and **Filter** narrows it down by mode, who can join, open seats and so on. **My Games** in the filter only shows rooms for games you have, plus every Stream Play room, since those don't need the game. Each room shows whether it's **Ready**, **Needs setup** or **Won't work** for you, and you can join any of them. If a room you know about doesn't show up, **Join by IP** lets you type the host's address, and **Refresh List** looks again.

### Inside a room

A room has a few tabs:

- **Room:** the players, the chat and the play button. Press **A** on a player to view their profile, add them as a friend or message them. The host can also **Drop** someone, which keeps them out until the room closes. There are also some options here such as changing between Hardcore and Softcore mode depending on play session.
- **Game Vote:** can't decide? The host starts a vote between 2 to 4 games and everyone picks one, or presses **Random Pick** and lets CheevoDeck choose.
- **Lounge:** quick two-player board games while you wait: Tic-tac-toe, Connect Four and Reversi.
- **Audio:** only in voice rooms. Volumes, mic sensitivity, lowering the game volume while people talk, and **Push to Talk**.
- **Stream Options:** only in Stream Play rooms. More on that further down.

If you want to talk only at the press of a button or just want to map mute to a button, set up **Push to Talk** and **Voice Mute** as Mapped Shortcuts in [Options](options.md). The **Set Up PTT/Mute** button in the **Audio** tab brings you straight there, and they work in a voice room even without Global Buttons turned on.

## Starting a Game

Here's how a typical round works:

1. **The host sets up the room.** Pick the game and the mode on the page (or press **Host** on a game's page), then **Host a Room**.
2. **Everyone else joins and presses Ready.** **Ready** only lights up once your device can play the room's game. If it's grayed out, press it anyway and **Fix It** shows you what's missing. In Link Play, pick your own game with **Change Game** first if you want a different one, which is good for trading Pokémon between two versions. Need a minute? **Unready** reverses your status, and everyone will see you are not readied. The host can still start the game without you though if he/she decides to.
3. **The host presses Host & Play.** In most rooms that needs at least one player ready, and the button waits until then. In Stream Play rooms and Couch Play rooms on RetroArch, the host can start any time, even alone, since people can jump in later. It's the same with Stream Play, where people can join in later if need be.
4. **The games launch on their own.** Everyone hears a little fanfare, the host's game starts first, and as soon as it's running, every player who was ready gets the game launched on their device automatically. You don't have to touch anything. If your game hasn't started within five minutes of the host's, you lose your spot for that round.
5. **Late arrivals.** In Stream Play rooms and Couch Play rooms on RetroArch, anyone can press **Join & Play** (or **Watch** in a Watch Only room) to jump into a game that's already going. In the others, you wait for the next round.
6. **When the game ends,** the room goes back to the lobby. The host can then pick something new with **Change Game** or a **Game Vote**, ready up, and go again.

Couch Play on GameCube, Wii and N64 needs one more step inside the emulator, because Dolphin and RMG run their own NetPlay. **Before You Play** on the page spells it out, but here's the gist:

- **Dolphin, host:** open **Tools**, then **Start NetPlay**, then **Host**. Pick the game and press **Start** once everyone has joined.
- **Dolphin, players:** open **Tools**, then **Start NetPlay**, then **Connect**. The host's address is already filled in.
- **RMG, host:** open **Netplay**, then **Create Session**. The server and your name are already filled in. Pick the game, type any session name, leave the password empty and press **Create**. When everyone shows up under **Players**, press **Start**.
- **RMG, players:** open **Netplay**, then **Browse Sessions**. Pick the session playing your game and press **Join**, and the host starts it from there.

## Link Play

Link Play is the closest thing to plugging a link cable between two Game Boys or connecting two GameCubes for network play for example. Everyone runs their own copy of the game on their own device, and the copies communicate with each other, so you each have your own save, your own screen and your own achievements. Hardcore or Softcore is up to each player too.

It works with the games that were made to link up:

- **Game Boy and Game Boy Color**, through RetroArch's Gambatte core.
- **Game Boy Advance**, through RetroArch's gpSP core, but only for the games CheevoDeck knows can link, like Pokémon Ruby, Sapphire, Emerald, FireRed and LeafGreen, Advance Wars and a few others.
- **DS**, through RetroArch's melonDS DS core (version 1.2.0 or newer). The standalone melonDS app can't do it.
- **PSP**, through PPSSPP or RetroArch's PPSSPP core. PSP Link Play is still experimental, so some games are hit and miss.
- **GameCube**, but only Mario Kart: Double Dash!!, Kirby Air Ride and 1080° Avalanche, through Dolphin.

Everyone needs the game on their own device, and for PSP and GameCube, everyone needs the same version of PPSSPP or Dolphin as the host (**Fix It** can update yours when you're behind). You don't all have to pick the exact same game, though. Each player can choose their own game with **Change Game**, so one of you can bring Pokémon Red and the other Pokémon Blue. If your game is different from the host's, the page warns you it might not link, since not every pair can.

Rooms can be Local or Online, except GameCube and PSP on RetroArch's PPSSPP core, which are Local only. Anyone who joins while a game is already running waits for the next round.

## Couch Play

Couch Play is like everyone sitting on the same couch around one console. The host's game is the one that counts, and everyone's controller is plugged into it over netplay, so you all see and play the same game together. Hardcore follows the host's setting for everyone.

It works with most of what RetroArch can run, like NES, SNES, Genesis, PC Engine, PS1 and Saturn, plus GameCube and Wii through Dolphin and N64 through RMG. It doesn't work with DS, PSP or PS2; however that's what Stream Play is for, which is capable of filling in the gaps.

Since everyone is running the same game in lockstep, everything has to match:

- **The same version of the game.** For NES, it has to be the exact same file.
- **The same emulator.** In RetroArch, you need the core the room uses, and for Dolphin and RMG, you need the same version as the host. A different RetroArch or core version only gets a warning, but it can still cause trouble.
- **The same screen refresh rate.** If one device runs at 90 Hz and another at 60 Hz, the game jitters or warps, so set everyone to the same rate in Steam's **Performance** menu.

A few systems go a certain way, so you'll want those emulators added to Steam even if every game has its own shortcut:

- **GameCube and Wii** always play through Dolphin's own shortcut, using Dolphin's NetPlay. You'll do a couple of steps in Dolphin itself, and **Before You Play** walks you through them.
- **N64** always plays through RMG's own shortcut, using RMG's Netplay, with a couple of steps there too. Heads up, RMG doesn't earn achievements, so N64 Couch Play is just for fun.
- **PlayStation** games set up in DuckStation play Couch Play in RetroArch instead, since DuckStation can't do it. Your DuckStation save won't carry over for that session, and **Before You Play** reminds you. The same goes for any game played with a different core than usual.

Couch Play rooms on RetroArch get a few extras:

- **Drop in any time:** anyone can press **Join & Play** while the game is already running.
- **Share Controls:** for single-player games, lets everyone control the game at the same time. With it off, everyone else just watches the host play. Leave it off for games with more than one player, so each person gets their own.
- **Watch Only:** everyone who joins watches you play and can't control the game. You can change it between games.
- **Adapters:** Genesis games use Sega's Team Player or EA's 4-Way Play for players 3 and 4, and PS1 games use a multitap. **Auto** picks the right one for most games, and if players 3 and up can't move, try the other.

## Stream Play

Stream Play lets you play a game with someone who doesn't have it. You play it exactly like you normally would, and everyone who joins sees your game and plays along with their own controller, as if they were sitting right next to you. One major benefit of Stream Play is that it allows hosts and clients alike to have friends connect their controllers locally to play with them online. The number next to the system icon (like Steam Machine, Steam Deck, etc.) indicates how many people have controllers connected locally for the client or host. Guests don't need the game, the emulator or any BIOS files, just a controller. Only the host earns achievements, since the game is only running on the host's device. Stream Play also has the most compatibility as it works with almost any game.

### Setting it up

Stream Play runs on two free programs: **Sunshine** shares your game when you host, and **Moonlight** shows the host's game when you join. The first time you pick Stream Play, press **Set Up Streaming** under the mode chart and CheevoDeck downloads and sets up both for you. It usually takes less than a minute, and you only do it once per device. It covers both hosting and joining, and everyone in the room needs it, guests included.

Moonlight gets its own hidden shortcut in Steam called **Moonlight (CheevoDeck)**, with its own settings, so if you already use Moonlight for something else, your copy is left alone.

The room's **Stream Options** tab has **Update Streaming Tools** and **Remove Stream Tools**. You can also remove them in [Options](options.md) under **System > General**.

### Hosting

Hosting via Stream Play needs a device with AMD graphics, like the Steam Deck or the Steam Machine. Sunshine needs a graphics chip that can encode video to keep up with a game, and CheevoDeck sets it up for AMD's. On anything else, **Host a Room** stays grayed out, and an error message will explain the situation. You can still join anyone's Stream Play room from that device, and Couch Play and Link Play aren't affected. So basically, on ARM devices, for now at least, you can join but not host for Stream Play.

Stream Play works with any system that has local multiplayer and without multiplayer (for viewing). PSP and DS games stream too, but guests can only watch, since those systems need one console per player. Your guests' controllers show up as extra controllers on your device, so the game sees them just like players 2, 3 and 4 plugged in next to you. In PCSX2 and DuckStation, Player 2 has to be set to a controller, and the page tells you if it isn't.

When you host an online room, CheevoDeck checks your upload speed first, and that decides how good the picture looks for guests joining over the internet. Each guest takes a share of it, so once it's used up, the next person who presses **Join & Play** is told your connection is too slow. The first guest always gets in, even on a slow connection, just with a softer picture. Guests on the same Wi-Fi as you don't eat into it.

While the game runs, your guests see your whole screen, the Quick Access Menu and notifications included, so don't type passwords or anything private while you're hosting. CheevoDeck reminds you when you host, until you tell it not to.

If you'd rather people just watch, turn on **Watch Only** and everyone who joins watches without controlling the game.

Set your screen to 60 Hz while you host, in Steam's **Performance** menu. The stream runs at 60 fps, so anything higher looks smooth to you but jittery to your guests.

### Joining

Join a Stream Play room like any other, even while the game is already running. Moonlight opens on its own and shows the host's game, sized to your screen up to 1080p (and never bigger than the host's screen), and it closes when you leave the room or the host's game ends. If Moonlight can't connect, you'll get a message, and **Join & Play** is still there to try again.

The video goes straight between your device and the host's whenever it can, and through the CheevoDeck server when it can't, which adds a little delay. The room's player list shows **In-Game (relay)** or **Watching (relay)** when that happens.

### Slow Connection

If the picture stutters or breaks up, turn on **Slow Connection** in the **Stream Options** tab. It halves the quality of the stream. On the host it lowers it for every guest, and on a guest it only lowers it for you.

## Friends

The **Friends** tab is its own friends list, separate from your RetroAchievements friends. Press **Add Friend** and type their RetroAchievements name, and once they accept you'll see when they're online, what they're playing and which room they're in. From a friend's card you can **Invite to My Room**, **Join Their Room** or open the **Message Center**, and inside a room, **Invite Friends** sends invites to as many as you like. Invites skip any password.

You can switch your status between Online and Hidden at the top of the tab, and **Play Together Service**, **Show Me Online** and **Suggest RA Friends** live in [Options](options.md) under **Social > Play Together**.

## The Play Together Card

**Notifications** keeps a **Play Together** card pinned at the top, so you can get to Play Together from anywhere without going through **Utilities**. Press the card and Play Together opens on **Play**. Down its right side, with no room open, are **Play Together Friends**, which opens the **Friends** tab, **Find a Room**, which opens the room list straight away so you don't have to open the page and scroll down for it, and the two [Offline Hotspot](offline-hotspot.md) buttons. Each button says what it does when you move onto it.

Once you're in a room, the card shows the game and how many seats are taken, and **Find a Room** makes way for **Close Room**, or **Leave Room** if it's someone else's room.

## How Games Launch

Play Together needs to know which of your files is the game, so it plays games that are in your [Cheevo Check](cheevo-check.md) results. If a game isn't there yet, run a scan on your entire ROM library, or let **Fix It** find just that game's file (see below), which is a lot quicker. It's still recommended to use the former for best long-term results. Whenever you add new games, you will have to run another scan but it gets faster the more you run it. After that, it launches the game one of three ways:

- **The game has its own Steam shortcut:** usually the one Steam ROM Manager made. Play Together launches through it, the same as pressing Play in your library, so your launcher, emulator and core all come along for the ride.
- **The game has no shortcut, but its emulator does:** with **Use Emulator Shortcuts** turned on (it's on by default, in [Options](options.md) under **Social > Play Together**), Play Together launches the game through the emulator's own shortcut instead. Link Play and Couch Play use RetroArch, Dolphin, RMG or PPSSPP this way, and Stream Play can also use DuckStation and PCSX2. EmuDeck users usually have these already, since Steam ROM Manager's **Emulators** parser is on by default. If you don't, **Fix It** can add one for you, or you can add it yourself in **Manage Emulators** by pressing **R2** on the emulator's row. While the game runs, Steam shows the emulator's name, but your room and your friends still see the game.
- **Neither:** the mode shows **Needs setup**. Press it and **Fix It** will show you what's missing.

GameCube, Wii, N64 and PlayStation games have a few rules of their own in Couch Play, covered in [Couch Play](#couch-play) above.

## When Something Needs Setup

Press **Needs setup** and the **Fix It** window opens. It figures out everything the mode is missing before it touches anything, then tells you in plain words under **What's missing**, lists the steps under **What the "Fix It" button below will do**, and tells you under **After this** whether the mode will be ready or if something's still left for you. One press of **Fix It** does all of it. Depending on what's missing, it can:

- turn on **Use Emulator Shortcuts**, install the emulator the game needs (Flatpak or AppImage, your pick) and add it to Steam
- install a RetroArch core, or update one that's too old (gpSP for Link Play, for example), and let you pick which core when more than one works
- install RetroArch itself, though it has to be opened once on its own before it can take a core, so the window tells you when that's the last thing left
- put an emulator back when its Steam shortcut is still there but the emulator was removed
- update Dolphin, RMG or PPSSPP to match the host's version, when the host is on the newest release and you're behind
- add the game's folder to Dolphin, so Dolphin's NetPlay can find it
- set up streaming for Stream Play
- find the game's file, when Cheevo Check hasn't found the game yet or the file has moved

That last one is the only time it needs a second press. Until CheevoDeck knows which file is the game, it can't tell what else the game needs, so **Fix It** opens a file picker, checks the file with RetroAchievements, then shows you the rest and waits for you to press **Fix It** again. If you picked the wrong one, **Pick a Different File** and **Forget This File** are right there. If the file is a GameCube or Wii disc and Dolphin's Flatpak isn't installed, it adds installing Dolphin to the plan and checks the same file afterwards, so you don't have to find it twice. **Run Cheevo Check Scan** is in the window too, if you'd rather scan your whole library.

You can close the window while it works and keep browsing, the mode shows how far along it is, and if **Fix It** needs to ask you something, the window pops back up. If a step fails, the window shows which one and why, and puts back what it can from the steps before it. To try again, close it and press **Needs setup**. If a core or emulator on your device is newer than the stable release, probably a nightly you installed yourself, it asks first: **Keep Mine** leaves it alone and stops there, and **Replace with Stable** swaps it.

You'll see the same window from **Play**, **Play With…** and **Host** on a game's page, and from the grayed out **Ready** or **Join & Play** button inside a room. From **Host**, it only covers getting the game's file and shortcut sorted (the window is called **Host: Needs setup**), then opens this page on that game so you can sort out the rest. When something can't be fixed at all, like a Wii game in Link Play, the window just tells you why.

The one thing **Fix It** won't do is make a shortcut for the game itself, since that's Steam ROM Manager's job. The window has a button for that: **Open EmuDeck in Desktop Mode** if you have EmuDeck, **Open Steam ROM Manager in Desktop Mode** if you have Steam ROM Manager, or **Install Steam ROM Manager** if you have neither.

If the host updates their emulator while the room's open, the room picks up the new version once they're back on this page, so anyone who updated to match can get in. Everyone presses **Ready** again after a change like that.

### Manage Emulators

Everything **Fix It** installs, you can also manage yourself in **Manage Emulators** in **Utilities**. Each emulator has a row for its Flatpak and one for its AppImage (RetroArch is Flatpak only), with a colored status on the right, and RetroArch's cores are under **Cores by System**. **Update All** updates everything that's out of date, **Y** updates all your cores, **R2** adds an emulator to Steam, and **L1** opens your backups, where you can put back the copy from before an update. Backups are kept for AppImages and cores (Flatpaks don't keep them), and you can turn that off with **Keep Backups**.

## No Wi-Fi Around

Play Together doesn't need a router. Turn on [Offline Hotspot](offline-hotspot.md) on one device, from **Utilities** or the Wi-Fi button on the **Play Together** card in **Notifications**, and everyone else joins it with **Join Offline Hotspot** on the same card. Rooms and friends then show up just like on your home Wi-Fi. If the host has no internet, rooms are Local only and achievements won't load.
