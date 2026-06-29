import { chromium } from 'playwright'
const routes = ['/uids','/batches','/qc','/intake','/joining','/dispatch','/manufacturing','/uid-lookup','/reports','/shifts','/job-assignment','/job-execution','/config','/master-lists','/tempering','/employees','/users']
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
await page.addInitScript(() => {
  localStorage.setItem('token','fake')
  localStorage.setItem('user', JSON.stringify({ id:1, username:'menon', full_name:'Jithesh Menon', role:'admin' }))
  localStorage.setItem('es-theme','daylight')
})
const base='http://127.0.0.1:4173'
for (const rt of routes) {
  const errs=[]
  page.removeAllListeners('pageerror'); page.on('pageerror', e=>errs.push(String(e)))
  await page.goto(base+rt, { waitUntil:'networkidle' }).catch(e=>errs.push('GOTO '+e))
  await page.waitForTimeout(500)
  const bodyLen = (await page.locator('body').innerText().catch(()=>'')).length
  console.log(`${errs.length?'❌':'✓'} ${rt}  text=${bodyLen}  ${errs.slice(0,1).join('')}`)
}
await browser.close()
