CREATE TABLE `advertising_ads` (
	`id` char(36) NOT NULL,
	`title` varchar(100) NOT NULL,
	`introduction_id` char(36) NOT NULL,
	`placements` json NOT NULL,
	`wide_image_id` char(36),
	`tall_image_id` char(36),
	`sort_order` int NOT NULL DEFAULT 0,
	`status` enum('draft','published','offline') NOT NULL DEFAULT 'draft',
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `advertising_ads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `advertising_audit` (
	`id` char(36) NOT NULL,
	`actor_id` char(36) NOT NULL,
	`target_id` varchar(36) NOT NULL,
	`action` varchar(40) NOT NULL,
	`before_value` json,
	`after_value` json,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `advertising_audit_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `advertising_background` (
	`id` varchar(16) NOT NULL,
	`image_id` char(36),
	`version` int unsigned NOT NULL DEFAULT 0,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `advertising_background_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `advertising_images` (
	`id` char(36) NOT NULL,
	`file` varchar(64) NOT NULL,
	`uploaded_by` char(36) NOT NULL,
	`purpose` enum('source','wide','tall','detail') NOT NULL,
	`source_image_id` char(36),
	`width` int unsigned NOT NULL,
	`height` int unsigned NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `advertising_images_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `advertising_introductions` (
	`id` char(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`company_name` varchar(200) NOT NULL,
	`contact_name` varchar(100) NOT NULL,
	`phone` varchar(40) NOT NULL,
	`wechat_id` varchar(100) NOT NULL,
	`summary` varchar(500) NOT NULL,
	`cover_image_id` char(36),
	`blocks` json NOT NULL,
	`status` enum('draft','published','offline') NOT NULL DEFAULT 'draft',
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `advertising_introductions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `advertising_ads` ADD CONSTRAINT `advertising_ads_introduction_id_advertising_introductions_id_fk` FOREIGN KEY (`introduction_id`) REFERENCES `advertising_introductions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `advertising_ads` ADD CONSTRAINT `advertising_ads_wide_image_id_advertising_images_id_fk` FOREIGN KEY (`wide_image_id`) REFERENCES `advertising_images`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `advertising_ads` ADD CONSTRAINT `advertising_ads_tall_image_id_advertising_images_id_fk` FOREIGN KEY (`tall_image_id`) REFERENCES `advertising_images`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `advertising_audit` ADD CONSTRAINT `advertising_audit_actor_id_admin_accounts_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `admin_accounts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `advertising_background` ADD CONSTRAINT `advertising_background_image_id_advertising_images_id_fk` FOREIGN KEY (`image_id`) REFERENCES `advertising_images`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `advertising_images` ADD CONSTRAINT `advertising_images_uploaded_by_admin_accounts_id_fk` FOREIGN KEY (`uploaded_by`) REFERENCES `admin_accounts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `advertising_introductions` ADD CONSTRAINT `advertising_intro_cover_image_fk` FOREIGN KEY (`cover_image_id`) REFERENCES `advertising_images`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `advertising_ads_order_idx` ON `advertising_ads` (`status`,`sort_order`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `advertising_audit_created_idx` ON `advertising_audit` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `advertising_introductions_status_idx` ON `advertising_introductions` (`status`,`created_at`,`id`);