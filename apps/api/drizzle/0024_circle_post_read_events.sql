CREATE TABLE `circle_post_read_events` (
  `id` char(36) NOT NULL,
  `post_id` char(36) NOT NULL,
  `member_id` char(36) NOT NULL,
  `recorded_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `circle_post_reads_post_member_time_idx` (`post_id`, `member_id`, `recorded_at`),
  CONSTRAINT `circle_post_read_events_post_id_circle_posts_id_fk` FOREIGN KEY (`post_id`) REFERENCES `circle_posts` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `circle_post_read_events_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE RESTRICT ON UPDATE NO ACTION
);
