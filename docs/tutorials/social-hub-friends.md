[← All tutorials](../tutorials.md)

# Social Hub Page: Friends

This is where you view all of your friends that you are following on RetroAchievements.org. Whenever you hover over them and pause for about 1 second, their current status will update live. Also, visiting their profile will update their status shown in the list. If you want to change the pause time when hovering, go to **Quick Menu > [Options](options.md) > Social Tab > Friend Refresh Time** to toggle different times.

On each friend "card", it shows their current username, their rich presence status, as well as the current game they are playing. In the upper left corner, if you see the mutual icon, it means both you and that friend have each other followed. In the upper right corner is the favorite button (the star). Clicking this, selecting this, or pressing its associated button adds that friend to your [favorites](social-hub-favorites.md) list.

Selecting a friend here will bring you to their [Profile](profile.md) page.

## Favoriting a Friend

Favoriting a friend makes them more likely to appear in featured unlocks that get sent to your notifications each tick. In addition, it also enables an extended check that the roster service performs to ensure their avatar is accurate. If favorited, they appear more often in the [Activity](social-hub-activity.md) feed in the Social Hub page as well.

## Resolving a Friend

You may have noticed the prompt above the friends list to "Resolve" a friend. Use this only if you notice your friend's avatar looks inaccurate, which is extremely rare. RetroAchievements stores everyone's picture at an address built from their username. The catch is that when someone changes their name, their picture doesn't move with it — it stays where it was. So the plugin can end up looking in the wrong place.

Usually that just means no picture, and you get their initial instead. CheevoDeck's roster service automatically heals this for most situations; however, there are super rare instances where it's stranger and isn't repaired properly: if somebody else has since taken your friend's old username, the old address now points at that person's picture, and you'll see a face that isn't theirs.

To fix this, go to your friends list (or favorites) within Social Hub and press the **Y** button "Resolve" option (**Triangle** for PlayStation controllers) while your friend is selected. Rare instances like this are handled automatically by default if your friend is favorited, so technically you could just favorite that friend to resolve them too.

The plugin doesn't ask RA for everyone automatically because it's one request per person, and a big friends list would be a lot of requests. In other words, it's extremely expensive and can involve too many requests hitting the RA API. It wouldn't be fair to RetroAchievements if the roster service did routine checks on a 100-friend list frequently, so out of respect for them, I've made it conditional. So in other words, if you see your friend's avatar is off, which is extremely rare, simply fix it permanently by pressing the "Resolve" button while over them in the friends list.

## My friend changed their avatar. When will it show up?

The friend avatar is cached for 48 hours, so it will be updated automatically via the backend roster service within that timeframe. If you would like to force the update immediately, an easy way to do this is to go to your friends list (or favorites) within Social Hub and press the **Y** button "Resolve" option (**Triangle** for PlayStation controllers) while your friend is selected. This will queue an immediate update, which will usually take place within ten seconds.

## My friend changed their username. When will it show up?

Since almost all operations are done via the users' ULID, everything will continue to work, and the roster service will update the username within one week automatically. If you want to change it immediately, from the main page go to **Quick Menu** (the hamburger-looking menu at the top) **> Options > Cache & Data Tab > Refresh Friends Now**.
