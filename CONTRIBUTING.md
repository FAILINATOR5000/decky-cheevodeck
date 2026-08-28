# Contributing to CheevoDeck

Thanks for thinking about helping out with CheevoDeck. It's currently a one-person project, so anybody who wants to pitch in is genuinely welcome. Please read the guidelines below so everything goes smoothly and you know what to expect. Thank you!

## Talk to me before you build something

If you've got a feature in mind, open a [Discussion](https://github.com/FAILINATOR5000/decky-cheevodeck/discussions) or a [feature request](https://github.com/FAILINATOR5000/decky-cheevodeck/issues/new/choose) and give me a chance to reply before you start writing it. Almost all of CheevoDeck lives inside the Quick Access Menu panel instead of a fullscreen dialog, and that one constraint decides the shape of nearly every feature, so it's genuinely easy to build something good that has nowhere to go once it's finished. A couple of messages up front usually sorts that out.

Bug fixes are different. If something's clearly broken and the fix is small, just send it and skip all of this.

The one thing I'd ask you not to start on your own is a big restructuring. If a branch moves a lot of code around at once I can't read it closely enough to be confident in it, so I'd end up either sitting on it or turning it down, and that costs you more than it costs me. If you think part of this needs reworking, say so first and I'll help break it into pieces I can actually review.

Check with me before adding a dependency, too. The Python side is standard library only, because Decky brings its own runtime and there's no pip step anywhere in the install, so **requests** and anything like it isn't available, and neither is **xml.etree**. The frontend is **@decky/ui** and **@decky/api** on React 19.

## Getting set up

Fork the repo, clone your fork, and branch off before you change anything:

```
git checkout -b feature/your-feature-name
```

The [Building](README.md#building) section of the README covers the rest of it: what you need installed, how to build, and how to get the result onto a device.

## Before you open a pull request

Run the checks. **npx tsc --noEmit** is the one that matters most, then **npx knip**, which sits at zero findings and I'd like to keep it there, and **ruff check main.py py_modules/** if you touched the backend. Please don't run **ruff format**, since it would reformat the whole backend away from how the rest of it is written.

Then test it on a device. I know that's a real ask if you haven't got one, and it does mean some contributions aren't practical for everybody, but nearly every bug that has ever mattered in this plugin got through tsc and knip without a word and only showed itself once it was running in the panel. Something that compiles cleanly doesn't tell me much on its own.

Run **.vscode/scripts/package.sh** before you call it done as well. It builds the zip the same way a release does and stops if anything is missing, so it's a decent last check. Don't attach that zip to the pull request though. I'd sooner read your branch and build it myself.

Keep it to one thing per pull request. A fix and a refactor in the same branch means I can't tell which change did what, and if I've got a question about one of them I end up holding up the other. Same goes for reformatting files you weren't otherwise touching, which turns a diff I could read at a glance into one I have to go through line by line.

If you added or changed anything a user reads, put the English string in **en.ts**. There are seven other locale files and every key in **en.ts** has to exist in all of them, but I'm not going to ask you to write translations for languages you don't speak. Add whichever ones you're comfortable with, mention in the pull request that the rest are missing, and I'll fill them in.

In the pull request itself, tell me what it changes and why, which device you tested on, and what you actually did with it. Commit subjects start with **Fix:**, **Feat:**, **Docs:** or **Chore:** and then a short capitalized summary, with anything longer going in the body.

I'm the only person reading these and I do it around the rest of my busy life, so giving me a little time is appreciated. If I turn something down I'll tell you why.

## Bug reports

Use the [issue templates](https://github.com/FAILINATOR5000/decky-cheevodeck/issues/new/choose). What helps most is a short description of what happened, the steps that got you there, what you expected instead, and which device and version you're on.

Logs help a lot and they're safe to send. There's nothing sensitive in them, no API keys or passwords, though they do carry your friends' RetroAchievements usernames and the paths of any ROM folders you've had CheevoDeck scan, so give one a quick look before you post it somewhere public.

## Code style

To keep things consistent with the rest of the project, I recommend matching whatever the file you're already in is doing. Typically, it is four spaces, no tabs.
