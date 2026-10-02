CREATE TABLE `circle_images` (
	`id` char(36) NOT NULL,
	`owner_id` char(36) NOT NULL,
	`filename` varchar(50) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `circle_images_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `circle_intents` (
	`id` char(36) NOT NULL,
	`post_id` char(36) NOT NULL,
	`member_id` char(36) NOT NULL,
	`request_id` char(36) NOT NULL,
	`phone` varchar(32) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `circle_intents_id` PRIMARY KEY(`id`),
	CONSTRAINT `circle_intents_retry_uq` UNIQUE(`post_id`,`member_id`,`request_id`)
);
--> statement-breakpoint
CREATE TABLE `circle_operations` (
	`id` char(36) NOT NULL,
	`post_id` char(36) NOT NULL,
	`admin_id` char(36) NOT NULL,
	`action` enum('remove','restore') NOT NULL,
	`reason` text NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `circle_operations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `circle_post_images` (
	`id` char(36) NOT NULL,
	`post_id` char(36) NOT NULL,
	`image_id` char(36) NOT NULL,
	`position` int unsigned NOT NULL,
	CONSTRAINT `circle_post_images_id` PRIMARY KEY(`id`),
	CONSTRAINT `circle_post_images_order_uq` UNIQUE(`post_id`,`position`),
	CONSTRAINT `circle_post_images_image_uq` UNIQUE(`post_id`,`image_id`)
);
--> statement-breakpoint
CREATE TABLE `circle_posts` (
	`id` char(36) NOT NULL,
	`author_id` char(36) NOT NULL,
	`request_id` char(36) NOT NULL,
	`category` enum('park','operation','service','store') NOT NULL,
	`subtype` enum('rent','sale','transfer','seek_rent','buy'),
	`title` varchar(200) NOT NULL,
	`body` text NOT NULL,
	`location` varchar(500),
	`area` varchar(100),
	`price` varchar(200),
	`valid_until` varchar(10),
	`store_name` varchar(200),
	`lifecycle` enum('open','ended') NOT NULL DEFAULT 'open',
	`moderation` enum('normal','removed') NOT NULL DEFAULT 'normal',
	`removal_reason` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `circle_posts_id` PRIMARY KEY(`id`),
	CONSTRAINT `circle_posts_request_uq` UNIQUE(`author_id`,`request_id`)
);
--> statement-breakpoint
ALTER TABLE `circle_images` ADD CONSTRAINT `circle_images_owner_id_members_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `circle_intents` ADD CONSTRAINT `circle_intents_post_id_circle_posts_id_fk` FOREIGN KEY (`post_id`) REFERENCES `circle_posts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `circle_intents` ADD CONSTRAINT `circle_intents_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `circle_operations` ADD CONSTRAINT `circle_operations_post_id_circle_posts_id_fk` FOREIGN KEY (`post_id`) REFERENCES `circle_posts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `circle_operations` ADD CONSTRAINT `circle_operations_admin_id_admin_accounts_id_fk` FOREIGN KEY (`admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `circle_post_images` ADD CONSTRAINT `circle_post_images_post_id_circle_posts_id_fk` FOREIGN KEY (`post_id`) REFERENCES `circle_posts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `circle_post_images` ADD CONSTRAINT `circle_post_images_image_id_circle_images_id_fk` FOREIGN KEY (`image_id`) REFERENCES `circle_images`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `circle_posts` ADD CONSTRAINT `circle_posts_author_id_members_id_fk` FOREIGN KEY (`author_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `circle_intents_post_idx` ON `circle_intents` (`post_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `circle_operations_post_idx` ON `circle_operations` (`post_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `circle_posts_public_idx` ON `circle_posts` (`moderation`,`category`,`created_at`);--> statement-breakpoint
CREATE INDEX `circle_posts_author_idx` ON `circle_posts` (`author_id`,`created_at`);