// Isolated layout preview: compiles actual Vue pages; never imports the real API/store.
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { log } from 'node:console'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mini = resolve(root, 'apps/miniapp')
const require = createRequire(resolve(mini, 'package.json'))
const { createServer, transformWithEsbuild } = require('vite')
const { parse, compileScript, compileStyle } = createRequire(require.resolve('vue'))('@vue/compiler-sfc')
const preview = resolve(root, '.codex-runtime-logs/visual-preview')
mkdirSync(preview, { recursive: true })
const paths = {
  editor: ['activity/editor', '发起活动'],
  activity: ['activity/index', '活动'], assistant: ['assistant/index', '助手'],
  mine: ['mine/index', '我的'], login: ['login/index', '登录与完善资料'],
  detail: ['activity/detail', '活动详情'], form: ['registration/form', '报名表'],
  result: ['registration/detail', '我的报名详情'], registrations: ['registration/index', '我的报名'],
}
const css = source => source.replace(/(?<![\w.-])(image|text|view)(?=[\s.{:#>])/g, tag => ({image:'img',text:'span',view:'div'}[tag])).replace(/(-?[\d.]+)rpx/g, (_, value) => `calc(${Number(value) / 750} * var(--screen-width))`)
const mock = `
import { reactive, onMounted } from 'vue';
export const page = new URLSearchParams(location.search).get('page') || 'activity';
export const member = { id:'visual-member', memberNumber:'HJ-视觉示例', displayName:'示例学友', avatarUrl:null, boundPhone:'13800000000', profileComplete:true, inviteCode:'VISUAL_ONLY' };
const session = reactive({ token:page==='login'?'':'visual-only-not-a-token', member:page==='login'?null:member, pendingInvite:'', clear(){this.token='';this.member=null} });
export const useSessionStore = () => session;
export const activity = {id:'visual-activity',title:'学加资产运营闭门沙龙：存量时代的增长机会',description:'视觉示例内容：交流资产运营实践，分享园区合作经验与行业观察。本预览不表示真实活动或真实报名。',coverUrl:'/static/huiju/campus.jpg',location:'深圳 · 南山科技园（视觉示例）',startsAt:'2026-10-18T06:00:00Z',endsAt:'2026-10-18T09:30:00Z',registrationDeadline:'2026-10-16T16:00:00Z',capacity:60,activeRegistrationCount:38,feeType:'paid',feeAmountCents:29900,registrationState:'open',organizer:member,consultationContact:'视觉示例咨询文本，无真实联系方式',questions:[
{id:'q1',type:'short_text',prompt:'您的公司 / 机构名称',required:true,options:null},
{id:'q2',type:'single',prompt:'您当前的从业方向',required:true,options:['地产开发','资产管理','投资机构','产业运营']},
{id:'q3',type:'multiple',prompt:'您最关注的话题',required:true,options:['城市更新','存量盘活','招商运营','资产证券化','组织能力']},
{id:'q4',type:'long_text',prompt:'您希望在本次活动中重点交流的问题',required:false,options:null}]};
const registration={id:'visual-registration',activityId:activity.id,status:'active',contactPhone:member.boundPhone,currentRegisteredAt:'2026-10-09T12:16:00Z',answers:[{questionId:'q1',value:'示例机构（仅视觉预览）'},{questionId:'q2',value:'资产管理'},{questionId:'q3',value:['城市更新','存量盘活']},{questionId:'q4',value:'希望交流园区运营经验和资源合作方式。本内容为独立视觉预览示例，不是真实报名。'}]};
export class ApiError extends Error {constructor(code,message,status){super(message);this.code=code;this.status=status}}
const noWrite=async()=>{throw new ApiError('VISUAL_ONLY','视觉预览不执行业务写入',400)};
export const api={managedActivity:async()=>({...activity,title:'',description:'',coverUrl:null,consultationContact:'',location:'深圳 · 南山科技园',feeType:'free',feeAmountCents:null,lifecycle:'draft',moderation:'normal',hasRegistrationEver:false}),createActivity:noWrite,updateActivity:noWrite,publishActivity:noWrite,activities:async()=>({items:[activity,{...activity,id:'visual-2',title:'走进园区参访交流',feeType:'free',feeAmountCents:null},{...activity,id:'visual-3',title:'产业资源对接沙龙'}]}),activity:async()=>activity,roster:async()=>({items:Array.from({length:8},(_,i)=>({displayName:'示例'+(i+1),avatarUrl:null}))}),myRegistration:async()=>{if(page==='form'||page==='detail')throw new ApiError('NOT_FOUND','无报名',404);return registration},registrations:async()=>({items:[{...registration,activity}]}),register:noWrite,editRegistration:noWrite,cancel:noWrite,login:noWrite,logout:noWrite,profile:noWrite,phone:noWrite,avatar:noWrite};
export const refreshMember=async()=>session.member;
export const errorMessage=e=>e.message;
export const mediaUrl=url=>url||'';
export const loginWithWechat=noWrite,uploadAvatar=noWrite,bootstrapIdentity=noWrite;
export const routes=${JSON.stringify(Object.fromEntries(Object.entries(paths).map(([k,v])=>[k,`/pages/${v[0]}`])))};
routes.registrations='/pages/registration/index';
export const navigate=url=>{const key=Object.keys(routes).find(k=>routes[k]===url.split('?')[0]);if(key)location.search='?page='+key};
export const loginPage=()=>navigate(routes.login),finishProfile=()=>navigate(routes.activity);
export const requireProfile=async()=>true;
export const unavailable=message=>window.alert(message+'（独立视觉预览）');
export const onLoad=cb=>cb({id:'visual-activity'}),onShow=cb=>onMounted(cb),onUnload=()=>{},onPullDownRefresh=()=>{},onShareAppMessage=()=>{};
`
writeFileSync(resolve(preview, 'mock.js'), mock)
const baseCss = css(readFileSync(resolve(mini, 'src/styles/huiju.scss'), 'utf8').replace(/\bpage\s*\{/g, 'body {'))
writeFileSync(resolve(preview, 'index.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>会聚 · 独立视觉预览</title><style>
html{scrollbar-width:none}html::-webkit-scrollbar{display:none}:root{--screen-width:min(100vw,430px)}*{box-sizing:border-box}body{margin:0;width:var(--screen-width);margin-inline:auto}button,input,textarea{font:inherit;border:0;outline:0}[scroll-x]{overflow-x:auto;max-width:100%}input,textarea{background:transparent}button{cursor:pointer;display:block;text-align:center}button.login-button{width:100%}img{object-fit:cover;display:inline-block}textarea{resize:none}#preview-warning{background:#fff1c8;color:#694818;padding:7px;font:11px sans-serif;text-align:center}#native-title{height:44px;display:flex;align-items:center;justify-content:center;background:#f7faf9;font:16px sans-serif}#app{min-height:calc(100vh - 102px)}#tabs{position:sticky;bottom:0;display:flex;justify-content:space-around;background:white;padding:12px;font:14px sans-serif;border-top:1px solid #eee}#tabs a{color:#14543f;text-decoration:none}.uni-icons{font-family:uniicons!important;line-height:1;display:inline-block;flex-shrink:0}@font-face{font-family:uniicons;src:url('/@fs/${mini.replaceAll('\\','/')}/src/uni_modules/uni-icons/components/uni-icons/uniicons.ttf')}
${baseCss}
.editor-footer{max-width:430px;margin-inline:auto}.fixed-footer{max-width:430px;margin-inline:auto}.fixed-footer button{min-width:0}.icon-placeholder{display:inline-block}
</style></head><body><div id="preview-warning">独立视觉预览 · 示例数据 · 不执行登录或业务写入</div><div id="native-title"></div><div id="app"></div><div id="tabs"><a href="?page=activity">活动</a><a href="?page=assistant">助手</a><a href="?page=mine">我的</a></div><script type="module" src="/entry.js"></script></body></html>`)
writeFileSync(resolve(preview, 'entry.js'), `
import {createApp,h} from 'vue';
import {fontData} from '/@fs/${mini.replaceAll('\\','/')}/src/uni_modules/uni-icons/components/uni-icons/uniicons_file_vue.js';
const pages=${JSON.stringify(paths)};const key=new URLSearchParams(location.search).get('page')||'activity';
if(!pages[key])throw new Error('Unknown preview page');
document.querySelector('#native-title').textContent=pages[key][1];
if(!['activity','assistant','mine'].includes(key))document.querySelector('#tabs').remove();
window.uni={pageScrollTo:({scrollTop})=>window.scrollTo(0,scrollTop),stopPullDownRefresh(){},showModal:async()=>({confirm:false}),setClipboardData(){},switchTab:({url})=>{const next=Object.keys(pages).find(k=>'/pages/'+pages[k][0]===url);if(next)location.search='?page='+next}};
const component=await import(/* @vite-ignore */ '/@fs/${mini.replaceAll('\\','/')}/src/pages/'+pages[key][0]+'.vue');
const app=createApp(component.default);app.component('uni-icons',{props:['type','size','color'],setup:p=>()=>h('span',{class:'uni-icons',style:{fontSize:typeof p.size==='string'&&p.size.endsWith('rpx')?'calc('+parseFloat(p.size)/750+' * var(--screen-width))':(p.size||16)+'px',color:p.color||'#333'}},fontData.find(f=>f.font_class===p.type)?.unicode||'')});app.mount('#app');
`)
const server = await createServer({
  configFile: false, envFile: false, root: preview, publicDir: resolve(mini, 'src'),
  resolve: { alias: [
    ...['@dcloudio/uni-app','@/stores/session','@/services/api','@/services/api/environment','@/services/navigation','@/services/wechat'].map(id => ({ find: new RegExp('^' + id + '$'), replacement: resolve(preview, 'mock.js') })),
    { find: 'vue', replacement: resolve(dirname(require.resolve('vue')), 'dist/vue.runtime.esm-bundler.js') },
  ] },
  optimizeDeps: { noDiscovery: true, include: ['vue'] },
  server: { host: '127.0.0.1', port: 4176, strictPort: true, fs: { allow: [root] } },
  plugins: [{
    name: 'isolated-miniapp-visual-preview',
    enforce: 'pre',
    resolveId(id) {
      if (['@dcloudio/uni-app','@/stores/session','@/services/api','@/services/api/environment','@/services/navigation','@/services/wechat'].includes(id)) return resolve(preview, 'mock.js')
      if ((id.startsWith('@/services/') && id !== '@/services/presentation') || id.startsWith('@/stores/')) throw new Error('Preview refuses unmocked service: ' + id)
      if (id.startsWith('@/')) return resolve(mini, 'src', id.slice(2)) + (id.endsWith('.vue') ? '' : '.ts')
    },
    async transform(source, id) {
      if (!id.endsWith('.vue')) return
      // Native primitives only: the script, template bindings and scoped CSS stay actual source.
      source = source.replace(/(<\/?)(view|text|scroll-view|image)(?=[\s/>])/g, (_, open, tag) => open + ({view:'div',text:'span','scroll-view':'div',image:'img'}[tag]))
      const { descriptor } = parse(source, { filename: id })
      const scope = 'data-v-' + createHash('sha1').update(id).digest('hex').slice(0, 8)
      const script = compileScript(descriptor, { id: scope, inlineTemplate: true })
      let code = script.content.replace('export default ', 'const component = ')
      const styles = descriptor.styles.map(style => compileStyle({ source: css(style.content), filename: id, id: scope, scoped: style.scoped }).code).join('\n')
      code += `\ncomponent.__scopeId=${JSON.stringify(scope)};const style=document.createElement('style');style.textContent=${JSON.stringify(styles)};document.head.append(style);export default component;`
      return await transformWithEsbuild(code, id + '.ts', { loader: 'ts' })
    },
  }],
})
await server.listen()
log('Isolated visual preview: http://127.0.0.1:4176/?page=activity (no real API, auth or database)')
