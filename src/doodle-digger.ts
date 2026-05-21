import { chromium, BrowserContext, Page, Frame, Locator } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import sharp from "sharp";

const PERSISTENT_CONTEXT_DIR = "./persistent_context";
const DOWNLOADS_DIR = "./images";

// Utility function to clean text for folder/file names
function cleanTextForPath(text: string, maxLength: number = 30): string {
  if (!text || text.trim().length === 0) return "unknown";

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, maxLength);
}

// Utility function to extract text content from an element with fallback
async function extractTextWithFallback(
  element: Locator,
  fallbackName: string,
  maxLength: number = 30
): Promise<string> {
  const text = await element.textContent();
  return text?.trim() ? cleanTextForPath(text, maxLength) : fallbackName;
}

// Utility function to create folder structure
function createFolderStructure(
  collectionName: string,
  pictureClassName: string,
  pictureName: string
): string {
  const basePictureFolder = path.join(
    DOWNLOADS_DIR,
    collectionName,
    pictureClassName,
    pictureName
  );
  !fs.existsSync(basePictureFolder) &&
    fs.mkdirSync(basePictureFolder, { recursive: true });
  return basePictureFolder;
}

async function waitAndClick(element: Locator): Promise<void> {
  await element.waitFor();
  await element.click();
}

// Cancel the preset preview to return to the preset list
async function goBackToPresetSelection(profileFrame: Frame): Promise<void> {
  const cancelButton = profileFrame.locator(
    'button[jsname="QApdW"]:has-text("Cancel")'
  );
  await cancelButton.waitFor();
  await cancelButton.click({ force: true });
  await cancelButton.waitFor({ state: "hidden" });
}

async function clickBackButton(profileFrame: Frame): Promise<void> {
  const backButton = profileFrame
    .locator('button[jsname="fYZky"][aria-label="Back"]:visible')
    .first();
  await backButton.waitFor({ state: "visible" });
  await backButton.click({ force: true });
}

// Back from picture-detail to picture-list. The "Presets" heading only exists
// on the picture-detail panel, so its detachment proves the swap completed.
async function clickBackToPictureList(profileFrame: Frame): Promise<void> {
  await clickBackButton(profileFrame);
  await profileFrame
    .locator('div[role="heading"]:has-text("Presets")')
    .first()
    .waitFor({ state: "detached" });
}

// Back from picture-list to the gallery. The gallery has many `section.u4mwyd`
// nodes; the picture-list panel has none — so waiting for the second one is a
// reliable "we're back at the gallery" signal.
async function clickBackToGallery(profileFrame: Frame): Promise<void> {
  await clickBackButton(profileFrame);
  await profileFrame.locator("section.u4mwyd").nth(1).waitFor();
}

// Basic image download function
const downloadImage = (url: string, filepath: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    https
      .get(url, (response) => response.pipe(file))
      .on("error", (err) => {
        fs.unlink(filepath, () => {});
        reject(err);
      });
    file.on("finish", () => {
      file.close();
      resolve();
    });
  });

// Helper function to download image to buffer
async function downloadImageToBuffer(
  src: string,
  basePictureFolder: string,
  index: number
): Promise<Buffer> {
  const tempPath = path.join(basePictureFolder, `temp_${index}.jpg`);
  await downloadImage(src, tempPath);
  const imageBuffer = fs.readFileSync(tempPath);
  fs.unlinkSync(tempPath); // Clean up temp file
  return imageBuffer;
}

// CSS filter application using Playwright
async function applyCSSFilterToImage(
  page: Page,
  imageUrl: string,
  cssFilter: string
): Promise<Buffer> {
  // Create a filtered image using browser's CSS filter and canvas
  const filteredImageData: string = await page.evaluate(
    async ({ url, filter }) => {
      return new Promise<string>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";

        img.onload = () => {
          // Create canvas and context
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");

          if (!ctx) {
            reject(new Error("Could not get canvas context"));
            return;
          }

          // Set canvas size to match image
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;

          // Clear canvas with transparent background
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          // Apply CSS filter to the canvas context
          ctx.filter = filter;

          // Draw the image with the filter applied
          ctx.drawImage(img, 0, 0);

          // Get the filtered image as base64 data URL (use PNG to preserve transparency)
          const dataUrl = canvas.toDataURL("image/png");
          resolve(dataUrl);
        };

        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = url;
      });
    },
    { url: imageUrl, filter: cssFilter }
  );

  // Convert base64 data URL to buffer
  const base64Data = filteredImageData.replace(/^data:image\/png;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");

  return buffer;
}

// Create composite image from processed image buffers
async function createCompositeFromBuffers(
  outputFolder: string,
  presetNumber: number,
  imageBuffers: Buffer[]
): Promise<void> {
  const pictureName = path.basename(outputFolder);
  const finalPath = path.join(
    outputFolder,
    `${pictureName}_${presetNumber}.jpg`
  );

  if (imageBuffers.length === 1) {
    // Single image, save it directly
    fs.writeFileSync(finalPath, imageBuffers[0]);
    console.log(`✅ Single image saved as: ${path.basename(finalPath)}`);
    return;
  }

  let baseImage = sharp(imageBuffers[0]);

  const overlays = imageBuffers.slice(1).map((buffer) => ({
    input: buffer,
    top: 0,
    left: 0,
    blend: "over" as const,
  }));

  await baseImage.composite(overlays).jpeg({ quality: 100 }).toFile(finalPath);
}

// Main function to download preset images
async function downloadPreset(
  profileFrame: Frame,
  page: Page,
  basePictureFolder: string,
  presetNumber: number
): Promise<void> {
  // Click "Next" button to view full picture with preset filters
  const nextButton = profileFrame.locator(
    'button:has(span[jsname="V67aGc"]:has-text("Next")), button[jsname="yTKzd"]:has-text("Next")'
  );
  await nextButton.waitFor();
  await nextButton.click();

  // imageContainer.waitFor below is the real signal that the preview is ready
  const imageContainer = profileFrame.locator("div.VnojDb.aAuPs");
  await imageContainer.waitFor();
  const images = imageContainer.locator("img.x1Lcpf");
  const imageCount = await images.count();

  // Download and process each image, collecting them for compositing
  const processedImages: Buffer[] = [];
  for (let i = 0; i < imageCount; i++) {
    const image = images.nth(i);
    let src = await image.getAttribute("src");
    if (src) {
      // Extract filter information from style attribute
      const style = await image.getAttribute("style");
      const filterInfo = style?.match(/filter:\s*([^;]+)/)?.[1]?.trim();

      // Modify the URL to get the highest resolution version
      if (src.includes("=s")) {
        src = src.replace(/=s\d+/g, "=s4096"); // Request 4096px version
      }

      const imageBuffer = filterInfo
        ? await applyCSSFilterToImage(page, src, filterInfo)
        : await downloadImageToBuffer(src, basePictureFolder, i);

      processedImages.push(imageBuffer);
    }
  }

  // Create the final composite image
  await createCompositeFromBuffers(
    basePictureFolder,
    presetNumber,
    processedImages
  );
}

(async (): Promise<void> => {
  console.log("⛏️  Doodle Digger - A Google Profile Picture Extractor");
  console.log("=====================================================");

  // Check if authentication exists
  if (!fs.existsSync(PERSISTENT_CONTEXT_DIR)) {
    console.error(
      "❌ No authentication found! Please run 'npm run setup' first."
    );
    process.exit(1);
  }

  // Launch browser with saved authentication
  console.log("🚀 Launching browser...");
  const context: BrowserContext = await chromium.launchPersistentContext(
    PERSISTENT_CONTEXT_DIR,
    {
      headless: false, // Set to true for headless operation
      viewport: { width: 1280, height: 720 },
    }
  );

  // Get the first tab and focus on it
  const pages = context.pages();
  const page = pages[0];
  await page.bringToFront();

  try {
    await page.goto("https://myaccount.google.com/personal-info", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForLoadState("load").catch(() => {});

    // Wait for and click on the profile picture change button
    console.log("📸 Clicking on profile picture...");
    const profilePictureButton = page.locator(
      'div[aria-label="Change profile photo"]'
    );
    await profilePictureButton.waitFor();
    await profilePictureButton.click();

    // Locate the profile-picture iframe — either already attached, or wait for it
    const profileFrame: Frame =
      page.frames().find((f) => f.url().includes("/profile-picture")) ??
      (await page.waitForEvent("framenavigated", {
        predicate: (f) => f.url().includes("/profile-picture"),
      }));

    // Click "Browse Illustrations" to enter the doodle gallery
    // (`:visible` skips the transition-layer duplicates that briefly exist during the modal animation)
    console.log("🎨 Clicking on Browse Illustrations...");
    const browseButton = profileFrame
      .locator('button[jsname="kQAOUc"]:visible')
      .first();
    await browseButton.waitFor({ state: "visible" });
    await browseButton.click();

    // Gallery loads within the same iframe — wait on the collections directly
    await profileFrame.locator("section.u4mwyd").first().waitFor();

    // Collect collection names upfront. Google reshuffles section order after each visit
    // (the just-visited collection bumps to position 1), so we iterate by name, not index.
    const collectionNames: string[] = (
      await profileFrame.evaluate(() =>
        Array.from(document.querySelectorAll("section.u4mwyd")).map(
          (s) => (s.querySelector("h3")?.textContent || "").trim()
        ).filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b)); // stable alphabetical order across runs
    console.log(`📚 Found ${collectionNames.length} collections: ${collectionNames.join(", ")}`);

    for (let collectionIndex = 0; collectionIndex < collectionNames.length; collectionIndex++) {
      const rawCollectionName = collectionNames[collectionIndex];
      const collectionName = cleanTextForPath(rawCollectionName, 30);

      console.log(
        `📘 Processing collection ${collectionIndex + 1} of ${collectionNames.length}: "${collectionName}"`
      );

      // Find the section by its heading text (robust to reshuffling)
      const currentCollection = profileFrame
        .locator(`section.u4mwyd:has(h3:text-is("${rawCollectionName}"))`)
        .first();
      await currentCollection.scrollIntoViewIfNeeded();

      const pictureClasses = currentCollection.locator("div.LWctvf");
      const pictureClassCount = await pictureClasses.count();

      for (let classIndex = 0; classIndex < pictureClassCount; classIndex++) {
        const currentPictureClass = pictureClasses.nth(classIndex);

        // Get the picture class name
        const pictureClassName = await extractTextWithFallback(
          currentPictureClass.locator(".nvhd9d").first(),
          `unknown_class_${classIndex + 1}`,
          30
        );

        console.log(
          `🏷️  Processing picture class ${
            classIndex + 1
          } of ${pictureClassCount}: "${pictureClassName}"`
        );

        // Click on the button within the picture class
        await waitAndClick(currentPictureClass.locator("button.WPmjde.Iq3YXe"));

        // Wait for the picture list to render
        const pictures = profileFrame.locator('div[role="listitem"]');
        await pictures.first().waitFor();
        const pictureCount = await pictures.count();

        for (let pictureIndex = 0; pictureIndex < pictureCount; pictureIndex++) {
          // Get the current picture
          const currentPicture = pictures.nth(pictureIndex);

          // Click on the picture button and wait for the detail view's Presets heading
          await waitAndClick(currentPicture.locator("button.EbkQ6c.Iq3YXe"));
          const presetsHeading = profileFrame.locator(
            'div[role="heading"]:has-text("Presets")'
          );
          await presetsHeading.waitFor();

          // Picture name is the last h1.i2Djkc on the detail view
          const pictureName = await extractTextWithFallback(
            profileFrame.locator("h1.i2Djkc").last(),
            `unknown_picture_${pictureIndex + 1}`,
            50
          );

          console.log(
            `🖼️  Processing picture ${
              pictureIndex + 1
            } of ${pictureCount}: "${pictureName}"`
          );

          // Find the next sibling div containing the preset labels
          const presetsContainer = presetsHeading
            .locator('xpath=following-sibling::div[contains(@class, "l1xIwe")]')
            .first();

          // Find radio buttons only within the presets container
          const presetRadios = presetsContainer.locator(
            'input[type="radio"][name="wtduFd"]'
          );
          const presetCount = await presetRadios.count();

          // Create base folder structure
          const basePictureFolder = createFolderStructure(
            collectionName,
            pictureClassName,
            pictureName
          );

          for (let presetIndex = 0; presetIndex < presetCount; presetIndex++) {
            console.log(
              `🎨 Processing preset ${
                presetIndex + 1
              } of ${presetCount} for ${pictureName}...`
            );

            // Select preset via programmatic JS click. A real browser click is routed
            // through the `.ZmdBVc` transition overlay, which hijacks pointer events and
            // can close the modal; a JS-dispatched click goes straight to the radio.
            const presetRadio = presetRadios.nth(presetIndex);
            await presetRadio.waitFor();
            await presetRadio.evaluate((el) => {
              const input = el as HTMLInputElement;
              input.click();
              input.parentElement?.click();
            });

            await downloadPreset(
              profileFrame,
              page,
              basePictureFolder,
              presetIndex + 1
            );
            console.log(`🎉 Downloaded preset ${presetIndex + 1}!`);

            await goBackToPresetSelection(profileFrame);
          }

          console.log(`📁 All images saved to: ${basePictureFolder}`);
          await clickBackToPictureList(profileFrame);
        }

        console.log(
          `🎊 Downloaded all ${pictureCount} pictures in "${pictureClassName}"!`
        );
        await clickBackToGallery(profileFrame);
      }

      console.log(
        `🎊 Downloaded all ${pictureClassCount} picture classes in "${collectionName}"!`
      );
    }

    console.log(`🎊 Downloaded all ${collectionNames.length} collections!`);
    console.log("🛑 Closing browser...");
    await context.close();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error during extraction:", (error as Error).message);
    console.log("🛑 Closing browser...");
    await context.close();
    process.exit(1);
  }
})();
