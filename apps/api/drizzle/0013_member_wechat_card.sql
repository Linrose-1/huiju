ALTER TABLE `member_visibilities` ADD `show_wechat_id` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `member_visibilities` ADD `show_wechat_qr` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `member_visibilities` ADD `show_personal_tag` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `wechat_id` varchar(100);--> statement-breakpoint
ALTER TABLE `members` ADD `personal_tag` varchar(50);--> statement-breakpoint
ALTER TABLE `members` ADD `wechat_qr_file` varchar(64);