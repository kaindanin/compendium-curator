# Compendium Curator

**English** | [Español](README.es.md)

## What is Compendium Curator?

Compendium Curator enhances the D&D5e Compendium Browser by allowing Game Masters to hide individual entries from installed compendiums without modifying or duplicating their original content.

Create independent profiles for different campaigns, worlds, or settings, and control which items, spells, features, and other entries players can find in the Compendium Browser.

Forget about spending hours creating and organizing custom compendiums just to combine selected content from different sourcebooks. Select what you do not want to display, hide it, and keep the Compendium Browser clean and adapted to each campaign.

## Features

* Hide individual entries from the Compendium Browser.
* Restore hidden entries.
* Select multiple entries using checkboxes.
* Select all visible entries with a master checkbox.
* Temporarily display hidden entries.
* Visually identify hidden entries.
* Create and delete configuration profiles.
* Maintain independent hidden-entry lists for each profile.
* Choose a fixed public profile for players.
* Allow the GM to change editing profiles without altering what players see.
* Automatically synchronize changes between connected clients.
* Restrict administration controls to users who can modify world settings.
* Preserve configuration data between sessions.
* Restrict entry previews to their names so they do not interfere with module controls.
* Interface available in English and Spanish.

## Requirements

* Foundry Virtual Tabletop 14 or later.
* D&D5e system 5.3.0 or later.

## Manual Installation

1. Download or copy the module folder.

2. Place it inside the Foundry modules directory:

   ```text
   Data/modules/compendium-curator
   ```

3. Restart Foundry Virtual Tabletop.

4. Enable **Compendium Curator** from the world's module settings.

## Usage

Open the D&D5e Compendium Browser.

Compendium Curator controls will appear at the top for users who have permission to modify world settings.

### Curator Mode

Click **Curator** to display selection checkboxes beside the entries.

After selecting entries, use:

* **Hide** to remove them from the browser.
* **Restore** to make them visible again.

The checkbox in the column header selects or deselects all currently visible entries.

### Hidden Entries

Click **Hidden** to temporarily display entries that are currently hidden.

Hidden entries appear faded. Disabling the option removes them from the browser again.

### Profiles

Each profile maintains its own list of hidden entries.

The profile selector changes the profile currently being edited by the GM.

The buttons beside the selector allow the GM to:

* Create a profile.
* Mark the active profile as public.
* Delete a profile.

The public profile is identified in the selector by the **Public** label.

### Public Profile

Players always use the profile marked as public.

The GM can switch to another profile to prepare content, perform tests, or configure a different campaign without changing what players can see.

When another profile is marked as public, open player browsers are updated automatically.

The public profile cannot be deleted until another profile has been marked as public.

## Permissions

Users with permission to modify world settings can:

* Enable Curator Mode.
* Display hidden entries.
* Hide and restore entries.
* Create, switch, and delete profiles.
* Choose the public profile.

Other players do not see the module controls and always use the rules from the public profile.

## Storage

Configuration is stored as a Foundry world setting.

Each world independently maintains:

* Its profiles.
* The GM's active profile.
* The public profile.
* The hidden entries belonging to each profile.

## Compatibility

Compendium Curator modifies the D&D5e Compendium Browser interface.

Future changes to the browser's internal structure may require an update to the module.

## Version

**0.1.0**

## Author

**Argulf**

## Support the Project

Compendium Curator is free and open-source.

If you find the module useful and would like to support its development and maintenance, you can buy me a coffee:

[Support the project on Ko-fi](https://ko-fi.com/argulf)
