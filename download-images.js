const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Read the imagekit-urls.json file
const imagekitUrlsPath = path.join(__dirname, 'imagekit-urls.json');
const publicDir = path.join(__dirname, 'public');

// Function to extract filename from URL
function extractFilename(url) {
  try {
    // Get the part after the last slash
    const urlParts = url.split('/');
    let filename = urlParts[urlParts.length - 1];
    
    // Remove query parameters if any
    filename = filename.split('?')[0];
    
    // Remove timestamp prefix if present (e.g., "1747199958831-filename.jpg" -> "filename.jpg")
    // Pattern: numbers followed by dash at the start
    const timestampPattern = /^\d+-/;
    if (timestampPattern.test(filename)) {
      filename = filename.replace(timestampPattern, '');
    }
    
    return filename;
  } catch (error) {
    console.error(`Error extracting filename from ${url}:`, error.message);
    return null;
  }
}

// Function to download an image
function downloadImage(url, filePath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    protocol.get(url, (response) => {
      if (response.statusCode === 200) {
        const fileStream = fs.createWriteStream(filePath);
        response.pipe(fileStream);
        
        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });
        
        fileStream.on('error', (err) => {
          fs.unlink(filePath, () => {}); // Delete the file on error
          reject(err);
        });
      } else if (response.statusCode === 301 || response.statusCode === 302) {
        // Handle redirects
        downloadImage(response.headers.location, filePath)
          .then(resolve)
          .catch(reject);
      } else {
        reject(new Error(`Failed to download: ${response.statusCode}`));
      }
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Function to recursively process object and replace URLs with filenames
function processObject(obj, folderName, folderPath, localPaths) {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => processObject(item, folderName, folderPath, localPaths));
  }
  
  const result = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && value.includes('imagekit.io')) {
      // Extract filename from URL
      const filename = extractFilename(value);
      if (filename) {
        const localPath = path.join(folderPath, filename);
        localPaths.push({ url: value, localPath, filename });
        result[key] = filename;
      } else {
        result[key] = value; // Keep original if extraction fails
      }
    } else if (typeof value === 'object' && value !== null) {
      result[key] = processObject(value, folderName, folderPath, localPaths);
    } else {
      result[key] = value;
    }
  }
  
  return result;
}

// Main function to download images and create local paths JSON
async function downloadAllImages() {
  try {
    // Read imagekit-urls.json
    if (!fs.existsSync(imagekitUrlsPath)) {
      console.error('❌ imagekit-urls.json not found! Please run extract-imagekit-urls.js first.');
      return;
    }
    
    const imagekitData = JSON.parse(fs.readFileSync(imagekitUrlsPath, 'utf8'));
    const localPathsData = {};
    
    console.log('📥 Starting image download process...\n');
    
    // Process each file (about, home, etc.)
    for (const [fileName, fileData] of Object.entries(imagekitData)) {
      console.log(`Processing ${fileName}...`);
      
      const folderPath = path.join(publicDir, fileName);
      const localPaths = [];
      
      // Delete folder if it exists
      if (fs.existsSync(folderPath)) {
        console.log(`  Deleting existing folder: ${folderPath}`);
        fs.rmSync(folderPath, { recursive: true, force: true });
      }
      
      // Create folder
      fs.mkdirSync(folderPath, { recursive: true });
      console.log(`  Created folder: ${folderPath}`);
      
      // Process the data structure and collect all image URLs
      const processedData = processObject(fileData, fileName, folderPath, localPaths);
      localPathsData[fileName] = processedData;
      
      // Download all images
      console.log(`  Downloading ${localPaths.length} images...`);
      let successCount = 0;
      let failCount = 0;
      
      for (const { url, localPath, filename } of localPaths) {
        try {
          await downloadImage(url, localPath);
          successCount++;
          console.log(`    ✓ Downloaded: ${filename}`);
        } catch (error) {
          failCount++;
          console.error(`    ✗ Failed to download ${filename}: ${error.message}`);
        }
      }
      
      console.log(`  ✅ ${fileName}: ${successCount} successful, ${failCount} failed\n`);
    }
    
    // Write local paths JSON file
    const localPathsPath = path.join(__dirname, 'local-image-paths.json');
    fs.writeFileSync(localPathsPath, JSON.stringify(localPathsData, null, 2), 'utf8');
    
    console.log(`\n✅ All downloads complete!`);
    console.log(`📄 Local paths saved to: ${localPathsPath}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  downloadAllImages();
}

module.exports = { downloadAllImages, extractFilename, downloadImage };

