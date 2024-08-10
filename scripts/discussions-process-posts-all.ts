import fs from 'node:fs';

import { deleteDiscussion, type IGithubEventPath, writeDiscussion } from './utils';

const discussionsProcessPosts = (githubEventPath: string) => {
  const event: IGithubEventPath = JSON.parse(fs.readFileSync(githubEventPath, 'utf-8'));
  const repoId = event.repository.node_id;
  const repoOwner = event.repository.owner.login;
  const repoName = event.repository.name;
  const categoryNmae = event.discussion.category.slug;

  const nums = parseInt(process.env.DISCUSSIONS_MAX_NUMS || '0');
  for (let i = 1; i <= nums; i++) {
    deleteDiscussion(categoryNmae, i);
    writeDiscussion(repoOwner, repoName, i, repoId);
  }
};

const init = () => {
  const args = process.argv;
  const githubEventPath = args[2];
  if (githubEventPath === undefined) {
    console.error('未提供任何参数');
    return process.exit(1);
  }
  if (!fs.existsSync(githubEventPath)) {
    console.error('文件不存在');
    return process.exit(1);
  }

  discussionsProcessPosts(githubEventPath);
};
init();
