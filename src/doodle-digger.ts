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

// Helper function to wait for element and click
async function waitAndClick(
  element: Locator,
  timeout: number = 5000
): Promise<void> {
  await element.waitFor({ timeout });
  await element.click();
}

// Utility function to go back to preset selection
async function goBackToPresetSelection(
  profileFrame: Frame,
  page: Page
): Promise<void> {
  const cancelButton = profileFrame.locator(
    'button[jsname="QApdW"]:has-text("Cancel")'
  );
  await cancelButton.waitFor({ timeout: 3000 });
  await cancelButton.click({ force: true });
  await page.waitForTimeout(500);
}

// Utility function to go back from preset selection to picture selection
async function goBackToPictureSelection(
  profileFrame: Frame,
  page: Page
): Promise<void> {
  const backButtons = profileFrame.locator(
    'button[jsname="fYZky"][aria-label="Back"]'
  );
  const correctBackButton = backButtons.nth(2); // It is the third back button
  await correctBackButton.click({ force: true });
  await page.waitForTimeout(1000); // Wait for navigation
}

// Utility function to go back from picture selection to picture class selection
async function goBackToPictureClassSelection(
  profileFrame: Frame,
  page: Page
): Promise<void> {
  const backButtons = profileFrame.locator(
    'button[jsname="fYZky"][aria-label="Back"]'
  );
  const correctBackButton = backButtons.nth(1); // It is the second back button
  await correctBackButton.click({ force: true });
  await page.waitForTimeout(1000); // Wait for navigation
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
  await nextButton.waitFor({ timeout: 5000 });
  await nextButton.click();

  await page.waitForTimeout(250); // Wait for full picture to load

  // Find and download images
  const imageContainer = profileFrame.locator("div.VnojDb.aAuPs");
  await imageContainer.waitFor({ timeout: 10000 });
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
      waitUntil: "networkidle",
      timeout: 10000,
    });

    // Wait for and click on the profile picture change button
    console.log("📸 Clicking on profile picture...");
    const profilePictureButton = page.locator(
      'div[aria-label="Change profile photo"]'
    );
    await profilePictureButton.waitFor({ timeout: 10000 });
    await profilePictureButton.click();
    await page.waitForTimeout(2000);

    // Find the profile picture iframe
    const iframes = await page.locator("iframe").all();

    let profileFrame: any = null;
    for (let i = 0; i < iframes.length; i++) {
      try {
        const frame = await iframes[i].contentFrame();
        if (frame) {
          const dialogCount = await frame.locator('div[role="dialog"]').count();
          const changeButtonCount = await frame
            .locator('button[jsname="oKomv"]')
            .count();
          const sectionsCount = await frame.locator("section").count();

          if (dialogCount > 0 || changeButtonCount > 0 || sectionsCount > 0) {
            profileFrame = frame;
            break;
          }
        }
      } catch {
        // Continue to next iframe
      }
    }

    if (!profileFrame) {
      profileFrame = await iframes[iframes.length - 1].contentFrame();
    }

    // Click the Change button
    console.log("🔄 Clicking on Change button...");
    const changeButton = profileFrame!.locator('button[jsname="oKomv"]');
    await changeButton.waitFor({ timeout: 10000 });
    await changeButton.click();

    // Wait for the picture selection interface to load
    await page.waitForTimeout(1000);

    // After clicking Change, the profile picture interface loads in iframe 2
    const newIframes = await page.locator("iframe").all();
    profileFrame = await newIframes[2].contentFrame(); // third iframe (0-indexed)

    // Wait a bit longer for the interface to fully load
    await page.waitForTimeout(1000);

    // Find sections with collections
    let collections = profileFrame.locator("section.u4mwyd");
    let collectionCountResult = await collections.count();

    // Process ALL collections
    for (
      let collectionIndex = 0;
      collectionIndex < collectionCountResult;
      collectionIndex++
    ) {
      const currentCollection = collections.nth(collectionIndex);

      // Get the collection name from the section
      const collectionName = await extractTextWithFallback(
        currentCollection.locator("h3").first(),
        `unknown_collection_${collectionIndex + 1}`,
        30
      );

      console.log(
        `📘 Processing collection ${
          collectionIndex + 1
        } of ${collectionCountResult}: "${collectionName}"`
      );

      // Find picture classes within the current collection
      const pictureClasses = currentCollection.locator("div.LWctvf");
      const pictureClassCount = await pictureClasses.count();

      // Process ALL picture classes in the collection
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

        // Wait for pictures to load
        await page.waitForTimeout(1000);

        // Find individual pictures in the iframe
        const pictures = profileFrame!.locator('div[role="listitem"]');
        const pictureCount = await pictures.count();

        // Process ALL pictures in the picture class
        for (
          let pictureIndex = 0;
          pictureIndex < pictureCount;
          pictureIndex++
        ) {
          // Get the current picture
          const currentPicture = pictures.nth(pictureIndex);

          // Click on the picture button
          await waitAndClick(currentPicture.locator("button.EbkQ6c.Iq3YXe"));

          // Wait for the picture preview to load
          await page.waitForTimeout(1000);

          // Extract the picture name from the h1.i2Djkc element
          const pictureName = await extractTextWithFallback(
            profileFrame!.locator("h1.i2Djkc").nth(2), // It is the third h1.i2Djkc element
            `unknown_picture_${pictureIndex + 1}`,
            50
          );

          console.log(
            `🖼️  Processing picture ${
              pictureIndex + 1
            } of ${pictureCount}: "${pictureName}"`
          );

          // Find preset radio buttons specifically under the "Presets" heading
          const presetsHeading = profileFrame!.locator(
            'div[role="heading"]:has-text("Presets")'
          );
          await presetsHeading.waitFor({ timeout: 5000 });

          // Then find the next sibling div that contains the preset labels
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

          // Download images for each preset
          for (let presetIndex = 0; presetIndex < presetCount; presetIndex++) {
            console.log(
              `🎨 Processing preset ${
                presetIndex + 1
              } of ${presetCount} for ${pictureName}...`
            );

            // Select preset
            const presetRadio = presetRadios.nth(presetIndex);
            await presetRadio.waitFor({ timeout: 5000 });
            await presetRadio.click({ force: true });
            await presetRadio.locator("xpath=..").click(); // Click parent label

            // Download images for this preset
            await downloadPreset(
              profileFrame!,
              page,
              basePictureFolder,
              presetIndex + 1
            );

            console.log(`🎉 Downloaded preset ${presetIndex + 1}!`);

            // Always go back to preset selection after downloading
            await goBackToPresetSelection(profileFrame!, page);
          }

          console.log(`📁 All images saved to: ${basePictureFolder}`);

          // Always go back to picture selection (needed for navigation to next picture or picture class)
          await goBackToPictureSelection(profileFrame!, page);
        }

        console.log(
          `🎊 Downloaded all ${pictureCount} pictures in "${pictureClassName}"!`
        );

        // Always go back to picture class selection (for next picture class or to be in correct state)
        await goBackToPictureClassSelection(profileFrame!, page);
      }

      console.log(
        `🎊 Downloaded all ${pictureClassCount} picture classes in "${collectionName}"!`
      );
    }

    console.log(`🎊 Downloaded all ${collectionCountResult} collections!`);
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
