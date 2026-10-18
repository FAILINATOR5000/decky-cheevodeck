[← All tutorials](../tutorials.md)

# Dolphin Mapper Page

Dolphin Mapper is the ultimate tool to make your achievement hunting more productive! No more hours of fiddling with different Wii control schemes in Dolphin before switching games. Dolphin Mapper works by injecting premade (I spent all the time making these for you all!) controller profiles into Dolphin's controller settings at the press of a button! You, of course, have to be out of the game and emulator first before doing it though, so no doing it live.

## How it Works

Simply scroll down and select your controller type, and expand the list for it if it isn't already. Then under that, look for the premade controller mapping you would like to apply, and then simply press **A** on it. BAM! Done!

If you want to modify an existing mapping, instead of pressing **A**, press **Y** on it to edit it. You can even delete them or re-order them. See the button prompts for more info. If you ever accidentally delete a profile or mess up some settings, no worries. You can reset your mappings to the defaults in the [Options](options.md) page.

Oh yeah, I forgot to mention, you can even create custom mappings! Got one Xbox 360 controller, one Xbox One controller, one Steam Controller, and one DualSense that you want to use to play Mario Kart local multiplayer? You can now make it happen! Simply select **Add Mapping** and add each controller.

When activating a multiplayer mapping, for the best results, make sure no controllers are connected first, and then connect each controller one at a time, preferably in the order of the mapping. You should be good to go! If you are on a Steam Deck or anything with a built-in controller, see the **Disable Steam Deck Controller** section first below under [Advanced Stuff](#advanced-stuff).

## Advanced Stuff

Under the Advanced section, you can do some crazy stuff here:

- **Disable Steam Deck Controller:** This is useful if you are playing multiplayer games docked on your TV on a Steam Deck or other handheld device with a built-in controller. The built-in controller interferes with the mappings, so it's best to turn it off.

  **Very Important Note:** Before toggling this setting on, make sure ALL controllers are disconnected from your device first, otherwise your device will freeze. Once everything is disconnected, toggle it on. Then turn on each controller one at a time, preferably in the order of the mapping you want to use. Once done, use one of the controllers to turn it back off. This is completely safe and doesn't damage anything, as a simple restart resets it, or manually toggling it off resets it.

- **Bluetooth Passthrough:** If you want the true Wii experience with the best input latency and proper speaker data being sent to your real Wii Remote, use Bluetooth passthrough. It only works on Steam Machine or other SteamOS devices with a compatible Bluetooth adapter. If you have a Steam Deck or other device that isn't supported, simply select the **Wii-Mote (Real)** mappings category and use that. It will work just fine, but speaker sound is disabled, as this garbles it.

- **Continuous Scanning:** Keeps Dolphin looking for real Wii Remotes and Balance Boards over Bluetooth.

- **Balance Board:** Toggling this on will allow Dolphin to detect and work with your real Wii Balance Board.

## Why isn't the mapping working for me?

First, make sure you selected a mapping that is under the correct category, meaning it is the category for the controller you are using. If you are using a Steam Deck's built-in controller, select that. If you are using an Xbox One controller, go under that category.

Next, if it still doesn't work, SteamOS can be a little glitchy sometimes. The Dolphin mappings are correct, but for some reason it isn't seeing your controller. 99% of the time, if I turn off my controller (usually by holding the Steam, Xbox, PS, or Home button for 5+ seconds), and then turn it back on, and then start the game, it works. Most of the time the mappings work, but sometimes in rare cases Steam's input is bugged, and simply getting out of the game and then turning the controller off and back on fixes it.

If you are doing multiplayer on Steam Deck, see the [Advanced Stuff](#advanced-stuff) section above about the **Disable Steam Deck Controller** option.

Also, if you are on a device like Steam Machine, turn off all controllers first. Then turn on each controller one by one, preferably in the mapping order.
