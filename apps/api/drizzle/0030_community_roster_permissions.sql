CREATE TABLE `roster_permission_audit` (
	`id` char(36) NOT NULL,
	`community_id` varchar(32) NOT NULL,
	`member_id` char(36) NOT NULL,
	`actor_id` char(36) NOT NULL,
	`before_value` json NOT NULL,
	`after_value` json NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `roster_permission_audit_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `community_members` ADD `can_view_roster` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `roster_permission_audit` ADD CONSTRAINT `roster_permission_audit_community_id_communities_id_fk` FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `roster_permission_audit` ADD CONSTRAINT `roster_permission_audit_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `roster_permission_audit` ADD CONSTRAINT `roster_permission_audit_actor_id_admin_accounts_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `admin_accounts`(`id`) ON DELETE no action ON UPDATE no action;