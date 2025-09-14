# Doodle Digger

Doodle Digger is a tool to extract and download the default Google profile pictures (doodles) using automated browser navigation.

## Description

Doodle Digger uses Playwright to automate the process of browsing to your Google My Account profile picture selection interface. It systematically navigates through all available doodle collections, applies different preset filters, and downloads high-resolution images organized in a structured folder hierarchy.

## Features

- Automated extraction of all Google doodle collections
- Downloads images with all available preset filters applied
- High-resolution image downloads (4096px)
- Organized folder structure by collection/class/picture
- Composite image creation for multi-layer doodles
- Persistent browser authentication for seamless operation

## Prerequisites

- Node.js (v14 or higher)
- Google account
- Internet connection

## Installation

1. Clone or download this repository
2. Navigate to the project directory
3. Install dependencies:

```bash
npm install
```

## Setup

Before running the main script, you need to authenticate with Google:

```bash
npm run setup
```

1. A regular Chromium browser will open
2. Sign in to Google
3. Keep the browser open and press ENTER in the terminal when ready
4. The script will then save your authentication state

## Usage

Once setup is complete, run the main extraction script:

```bash
npm start
```

The script will:

- Launch the browser with your saved authentication
- Navigate to Google My Account profile picture section
- Systematically browse through all doodle collections
- Download images for each preset filter
- Organize files in the `./images/` directory

## Output Structure

Downloaded images are organized as follows:

```bash
images/
├── collection_name/
│   ├── picture_class_name/
│   │   ├── picture_name/
│   │   │   ├── picture_name_1.jpg
│   │   │   ├── picture_name_2.jpg
│   │   │   └── ...
```

Where:

- `images/`: Root directory for all downloaded images
- `collection_name/`: The doodle collection (e.g., "animals", "nature")
- `picture_class_name/`: Sub-category within the collection
- `picture_name/`: Individual doodle name
- `picture_name_#/`: Different preset filters applied

## Dependencies

- [Playwright](https://playwright.dev/) - Browser automation
- [playwright-extra](https://www.npmjs.com/package/playwright-extra) - Enhanced Playwright features
- [puppeteer-extra-plugin-stealth](https://www.npmjs.com/package/puppeteer-extra-plugin-stealth) - Stealth plugin for browser automation
- [Sharp](https://sharp.pixelplumbing.com/) - Image processing

## Disclaimer

This tool is for personal use only. Ensure you comply with Google's Terms of Service when using this tool. The author is not responsible for any misuse or violation of terms.
