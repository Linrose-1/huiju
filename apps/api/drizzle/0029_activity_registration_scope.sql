ALTER TABLE `activities`
  ADD `community_id` varchar(32) DEFAULT 'xuejia' NOT NULL,
  ADD `registration_scope` enum('all','registered','unregistered') DEFAULT 'all' NOT NULL,
  ADD CONSTRAINT `activities_community_id_communities_id_fk` FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON DELETE no action ON UPDATE no action;
