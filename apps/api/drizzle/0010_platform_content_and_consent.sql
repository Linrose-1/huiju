CREATE TABLE `legal_consents` (
	`id` char(36) NOT NULL,
	`member_id` char(36) NOT NULL,
	`terms_version` varchar(64) NOT NULL,
	`privacy_version` varchar(64) NOT NULL,
	`agreed_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `legal_consents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `platform_audit` (
	`id` char(36) NOT NULL,
	`actor_type` enum('admin','member') NOT NULL,
	`actor_id` char(36) NOT NULL,
	`action` enum('content','editor') NOT NULL,
	`target_member_id` char(36),
	`before_value` json NOT NULL,
	`after_value` json NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `platform_audit_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `platform_content` (
	`id` varchar(32) NOT NULL,
	`activity_text` varchar(200) NOT NULL,
	`assistant_text` varchar(200) NOT NULL,
	CONSTRAINT `platform_content_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `platform_editors` (
	`member_id` char(36) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `platform_editors_member_id` PRIMARY KEY(`member_id`)
);
--> statement-breakpoint
ALTER TABLE `legal_consents` ADD CONSTRAINT `legal_consents_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `platform_editors` ADD CONSTRAINT `platform_editors_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `legal_consents_member_idx` ON `legal_consents` (`member_id`,`agreed_at`);--> statement-breakpoint
CREATE INDEX `platform_audit_created_idx` ON `platform_audit` (`created_at`,`id`);