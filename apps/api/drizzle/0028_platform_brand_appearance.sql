CREATE TABLE `platform_brand_images` (
	`id` char(36) NOT NULL,
	`purpose` varchar(4) NOT NULL,
	`mime_type` varchar(20) NOT NULL,
	`base64` mediumtext NOT NULL,
	`uploaded_by` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `platform_brand_images_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `platform_brand` ADD `appearance` json;--> statement-breakpoint
ALTER TABLE `platform_brand_images` ADD CONSTRAINT `platform_brand_images_uploaded_by_admin_accounts_id_fk` FOREIGN KEY (`uploaded_by`) REFERENCES `admin_accounts`(`id`) ON DELETE restrict ON UPDATE no action;