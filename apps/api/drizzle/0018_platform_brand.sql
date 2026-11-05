CREATE TABLE `platform_brand` (
	`id` varchar(32) NOT NULL,
	`display_name` varchar(30) NOT NULL,
	`visible` boolean NOT NULL DEFAULT true,
	`version` int unsigned NOT NULL DEFAULT 1,
	CONSTRAINT `platform_brand_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `platform_brand_audit` (
	`id` char(36) NOT NULL,
	`actor_id` char(36) NOT NULL,
	`before_value` json NOT NULL,
	`after_value` json NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `platform_brand_audit_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `platform_brand_audit` ADD CONSTRAINT `platform_brand_audit_actor_id_admin_accounts_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `admin_accounts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `platform_brand_audit_created_idx` ON `platform_brand_audit` (`created_at`,`id`);