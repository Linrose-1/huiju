import { createRouter, createWebHistory } from 'vue-router'
import { allowedRoute } from '../services/access'
import { session } from '../services/admin'
import LoginPage from '../modules/auth/LoginPage.vue'
import PasswordPage from '../modules/auth/PasswordPage.vue'
import AccountsPage from '../modules/accounts/AccountsPage.vue'
import MembersPage from '../modules/members/MembersPage.vue'
import FeedbackPage from '../modules/feedback/FeedbackPage.vue'
import AnalyticsPage from '../modules/analytics/AnalyticsPage.vue'
import EngagementPage from '../modules/analytics/EngagementPage.vue'
import ContentPage from '../modules/content/ContentPage.vue'
import ActivitiesPage from '../modules/activities/ActivitiesPage.vue'
import CirclePage from '../modules/circle/CirclePage.vue'

export { allowedRoute } from '../services/access'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/analytics', component: AnalyticsPage },
    { path: '/engagement', component: EngagementPage },
    { path: '/content', component: ContentPage },
    { path: '/login', component: LoginPage },
    { path: '/password', component: PasswordPage },
    { path: '/feedback', component: FeedbackPage },
    { path: '/activities', component: ActivitiesPage },
    { path: '/circle', component: CirclePage },
    { path: '/members', component: MembersPage },
    { path: '/accounts', component: AccountsPage },
    { path: '/:pathMatch(.*)*', redirect: '/analytics' },
  ],
})
// App keeps business views hidden until the initial cookie check completes.
router.beforeEach((to) => session.initialized ? allowedRoute(to.path) : undefined)
