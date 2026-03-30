const { sendCommand } = require('./figma.js');
async function run() {
  const vars = await sendCommand('get_all_document_variables', {});
  console.log(vars.find(v => v.name.includes('0')));
}
run();
