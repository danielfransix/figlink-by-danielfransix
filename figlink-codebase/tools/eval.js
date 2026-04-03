const { sendCommand } = require('./process.js');

async function run() {
  console.log('Fetching local styles...');
  const { textStyles } = await sendCommand('get_local_styles', {});
  
  const titleStyles = textStyles.filter(s => s.name.toLowerCase().includes('text-title'));
  console.log(`Found ${titleStyles.length} text-title styles.`);

  const hugStyles = titleStyles.filter(s => s.name.toLowerCase().includes('-hug'));
  console.log(`Found ${hugStyles.length} -hug styles.`);

  const itemsToUpdate = [];

  for (const hugStyle of hugStyles) {
    const baseName = hugStyle.name.replace(/-hug/i, '').trim();
    
    const baseStyle = titleStyles.find(s => s.name === baseName);
    if (baseStyle) {
      if (hugStyle.fontSize !== baseStyle.fontSize) {
        console.log(`Matching: "${hugStyle.name}" (size ${hugStyle.fontSize}) -> "${baseStyle.name}" (size ${baseStyle.fontSize})`);
        itemsToUpdate.push({
          styleId: hugStyle.id,
          field: 'fontSize',
          value: baseStyle.fontSize
        });
      } else {
         console.log(`Skip: "${hugStyle.name}" already matches "${baseStyle.name}" size (${baseStyle.fontSize})`);
      }
    } else {
      console.log(`Warning: Could not find base style for "${hugStyle.name}" (looked for "${baseName}")`);
    }
  }

  if (itemsToUpdate.length > 0) {
    console.log(`Updating ${itemsToUpdate.length} styles...`);
    const results = await sendCommand('bulk_set_style_property', { items: itemsToUpdate });
    const success = results.filter(r => r.ok).length;
    console.log(`Successfully updated ${success}/${itemsToUpdate.length} styles.`);
  } else {
    console.log('No styles need updating.');
  }
}

run().catch(console.error);
