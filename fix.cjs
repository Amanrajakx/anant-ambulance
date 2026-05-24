const fs = require('fs');
const files = ['index.html', 'antim-sanskar.html', 'booking-form.html', 'admin.html', 'emergency.html', 'tracking.html'];
for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let content = fs.readFileSync(file, 'utf8');
    
    // Replace absolute paths with relative paths
    content = content.replace(/href=\"\/(style\.css)\"/g, 'href=\"./$1\"');
    content = content.replace(/src=\"\/(main\.js)\"/g, 'src=\"./$1\"');
    content = content.replace(/src=\"\/([^\"' >]+\.(jpg|png|svg|webp))\"/g, 'src=\"./$1\"');
    
    // For navigation links
    content = content.replace(/href=\"\/(index\.html|antim-sanskar\.html|emergency\.html|booking-form\.html|admin\.html|tracking\.html)\"/g, 'href=\"./$1\"');
    
    fs.writeFileSync(file, content);
    console.log('Updated ' + file);
}

// Update vite.config.js to include base: './'
let viteConfig = fs.readFileSync('vite.config.js', 'utf8');
if (!viteConfig.includes('base:')) {
    viteConfig = viteConfig.replace('export default defineConfig({', 'export default defineConfig({\n  base: "./",');
    fs.writeFileSync('vite.config.js', viteConfig);
    console.log('Updated vite.config.js');
}
