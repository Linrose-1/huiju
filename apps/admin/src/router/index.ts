import { createRouter, createWebHistory } from 'vue-router'
import { allowedRoute } from '../services/access'
import LoginPage from '../modules/auth/LoginPage.vue'
import PasswordPage from '../modules/auth/PasswordPage.vue'
import AccountsPage from '../modules/accounts/AccountsPage.vue'
import MembersPage from '../modules/members/MembersPage.vue'
import FeedbackPage from '../modules/feedback/FeedbackPage.vue'

export { allowedRoute } from '../services/access'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginPage },
    { path: '/password', component: PasswordPage },
    { path: '/feedback', component: FeedbackPage },
    { path: '/members', component: MembersPage },
    { path: '/accounts', component: AccountsPage },
    { path: '/:pathMatch(.*)*', redirect: '/feedback' },
  ],
})
router.beforeEach((to) => allowedRoute(to.path))
