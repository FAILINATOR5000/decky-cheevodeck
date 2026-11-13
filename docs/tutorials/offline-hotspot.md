[← All tutorials](../tutorials.md)

# Offline Hotspot Page

Offline Hotspot turns your device into a Wi-Fi network that other devices running CheevoDeck can join, so you can use [Play Together](play-together.md) on a plane, in a car, at a friend's place with no Wi-Fi, or anywhere else there's no router. You'll find it in **Utilities**, and the Wi-Fi button on the **Play Together** card in **Notifications** turns it on and off too. That button turns blue while the hotspot is on. It can't be mapped to a button or added as a **Quick Menu** tile on its own, but if you want it one press away, map **Notifications** in **Mapped Shortcuts** and the card is right there, game running or not.

## Turning it on

Flip **Offline Hotspot** on. The first time, a short explanation comes up, and nothing changes until you press **Turn On**. Check **Don't show again** and every time after that, it just turns straight on or off.

The page shows the hotspot's name, something like `CheevoDeck-07A5`, and lists everyone who's connected under **Connected Devices**. The bell turns blue while it's on, and you'll get a notification saying it's on. Select that notification to come back to the page, or press the Wi-Fi button on the **Play Together** card, which is blue while the hotspot is on, to turn it off.

## Dedicated Hotspot

On a Steam Deck OLED or a Steam Machine, **Dedicated Hotspot** shows up while you're hosting, and it's on by default. With it on, the hotspot is just for gaming: your device leaves your home Wi-Fi while it's on, nothing from the internet is shared, and games run better over it. Turn it off and your device stays on your Wi-Fi and runs the hotspot alongside it, so the people who join get your internet too. Changing it restarts the hotspot, so anyone connected joins again.

What happens to your own Wi-Fi depends on the device:

- **Steam Deck LCD:** its Wi-Fi card can't do both at once, so your network is paused while the hotspot is on, and the Deck goes back to it as soon as you turn the hotspot off.
- **Steam Deck OLED or Steam Machine on Wi-Fi:** paused too with **Dedicated Hotspot** on, and kept with it off. If your router is on a channel a hotspot can't use, your network is paused either way, and the page tells you.
- **A Steam Machine on Ethernet:** keeps its internet the whole time, and shares it with everyone who joins.

If the people on the hotspot have internet through it, achievements, online rooms and voice work like they do at home. If they don't, everything is offline: Local rooms only, and a game started with no internet won't load its achievements. The page tells you which one you're in.

## Joining one

On the other device, press **Join Offline Hotspot** on the **Play Together** card in **Notifications**, or go to **Utilities > Offline Hotspot** and pick it under **Join a Hotspot**. Nearby CheevoDeck hotspots show up by name with their signal strength, and the list refreshes every few seconds. Pick one and you're in, no password needed unless it's a Private Hotspot. Your device leaves its own Wi-Fi while it's connected, and **Leave Offline Hotspot** on the card (or **Leave Hotspot** on the page) takes you back.

From there, open **Play Together** like you normally would. **Find a Room** shows the rooms on the hotspot, and your Play Together friends who are on it show as online, along with the room they're in, even with no internet at all. Friend requests do need the internet, so add each other as friends beforehand.

## Private Hotspot

By default, anyone nearby running CheevoDeck can join your hotspot. It already keeps out devices without CheevoDeck and encrypts everything sent over it, but if you want to keep it to just your group, turn on **Private Hotspot**. It gets an 8-digit password, shown in orange on your page, and everyone joining types it in. Its name ends in `-P` so everyone can tell which kind it is. You can turn it on or off while the hotspot is running, but that restarts it with a new name and password, so everyone has to join again. The password is just for keeping your game session to yourselves, so don't use it for anything important.

## While you're in a room

The hotspot can't be turned on or off while you're hosting or in a room, since that would change your device's address while everyone else is in it. You'll see **Close the room first** or **Leave the room first**. The same goes for **Private Hotspot**, **Dedicated Hotspot** and joining a hotspot. Close or leave the room, change what you need, and host again.

## When it turns itself off

It stays on until you turn it off, but it also turns itself off so nobody ends up stuck on a network they didn't mean to stay on:

- after 23 hours, with a heads-up 5 minutes before,
- when the device goes to sleep,
- when Wi-Fi is switched off,
- when you leave Game Mode.

Your normal Wi-Fi comes back on its own each time. A restart always turns the hotspot off too, and CheevoDeck's **Factory Reset** turns it off before anything else.

## Devices without CheevoDeck

A phone or a PC can join too, but there's nothing on the hotspot to give it an address, so you'll have to set one by hand. The page shows one you can use, along with the mask.
