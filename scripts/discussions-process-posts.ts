import fs from 'node:fs';
import path from 'node:path';

import { graphql } from '@octokit/graphql';

interface IDiscussionRes {
  repository: {
    pinnedDiscussions: {
      nodes: {
        discussion: {
          number: number;
        };
      }[];
    };
    discussion: {
      title: string;
      body: string;
      createdAt: string;
      updatedAt: string;
      category: {
        slug: string;
      };
      labels: {
        nodes: { name: string }[];
      };
    };
  };
}

type TAction = 'created' | 'edited' | 'deleted' | 'pinned' | 'unpinned' | 'labeled' | 'unlabeled' | 'category_changed';
interface IGithubEventPath {
  action: TAction;
  discussion: {
    number: number;
    category: {
      slug: string;
    };
  };
  repository: {
    node_id: string;
    name: string;
    owner: {
      login: string;
    };
  };
}

function getFrontMatter(lines: string[]) {
  const frontMatter: Record<string, string | string[]> = {};
  const remaining: string[] = [];

  let started = false;
  let ended = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimedLine = line.trim();
    if (ended) {
      remaining.push(line);
      continue;
    }
    if (started) {
      if (trimedLine === '-->') {
        ended = true;
        continue;
      }
      const [key = '', value = ''] = trimedLine.split(':');
      frontMatter[key.trim()] = value.trim();
    } else if (trimedLine === '<!--') {
      started = true;
    } else {
      remaining.push(line);
    }
  }

  while (remaining.length > 0 && remaining[0]?.trim() === '') {
    remaining.shift();
  }
  return { frontMatter, remaining };
}
async function writeDiscussion(repoOwner: string, repoName: string, discussionNumber: number, repoId: string) {
  console.log(`Write discussion https://github.com/${repoOwner}/${repoName}/discussions/${discussionNumber}`);

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const graphqlAuth = graphql.defaults({
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
    },
  });

  const gql = String.raw;
  const res: IDiscussionRes = await graphqlAuth(
    gql`
        query {
          repository(owner: "${repoOwner}", name: "${repoName}") {
            pinnedDiscussions(last: 100) {
              nodes {
                discussion {
                  number
                }
              }
            }
            discussion(number: ${discussionNumber}) {
              title
              body
              createdAt
              updatedAt
              category{
              name
                slug
              }
              labels(last: 10) {
                nodes {
                  name
                }
              }
            }
          }
        }
    `,
  );

  const pinnedNumbers = res.repository.pinnedDiscussions.nodes.map(node => node.discussion.number);
  const discussion = res.repository.discussion;
  const category = discussion.category.slug;

  const dir = path.join('src/content/blog', category);
  fs.mkdirSync(dir, { recursive: true });

  const lines = discussion.body.split('\r\n');
  const { frontMatter, remaining } = getFrontMatter(lines);
  if (!frontMatter.title) frontMatter.title = discussion.title;
  if (!frontMatter.pubDatetime) frontMatter.pubDatetime = discussion.createdAt;
  if (!frontMatter.modDatetime) frontMatter.modDatetime = discussion.updatedAt;
  if (!frontMatter.tags) frontMatter.tags = discussion.labels.nodes.map(label => label.name);
  if (!frontMatter.featured) frontMatter.featured = `${pinnedNumbers.includes(discussionNumber)}`;
  if (!frontMatter.description) frontMatter.description = discussion.title;

  const result: string[] = [];
  result.push('---');
  const matterKeys = Object.keys(frontMatter).sort();
  for (const key of matterKeys) {
    const value = frontMatter[key];
    if (typeof value === 'string') {
      result.push(`${key}: ${value}`);
    } else if (typeof value === 'object' && value.length) {
      result.push(`${key}:`);
      for (const v of value) {
        result.push(`  - ${v}`);
      }
    } else {
      console.error(`Invalid value for ${key}: ${value}`);
    }
  }
  result.push('---');
  result.push(...remaining);
  result.push(
    `<script src="https://giscus.app/client.js"
      data-repo="${repoOwner}/${repoName}"
      data-repo-id="${repoId}"
      data-mapping="number"
      data-term="${discussionNumber}"
      data-reactions-enabled="1"
      data-emit-metadata="1"
      data-input-position="top"
      data-theme="preferred_color_scheme"
      data-lang="zh-CN"
      data-loading="lazy"
      crossorigin="anonymous"
      async />`,
  );

  fs.writeFileSync(path.join(dir, `${discussionNumber}.md`), result.join('\n'));
}
function deleteDiscussion(categoryNmae: string, discussionNumber: number) {
  const filepath = path.join('src/content/blog', categoryNmae, `${discussionNumber}.md`);
  if (fs.existsSync(filepath)) {
    console.log(`Deleting ${filepath}`);
    fs.rmSync(filepath);
  }
}

const discussionsProcessPosts = (githubEventPath: string) => {
  const event: IGithubEventPath = JSON.parse(fs.readFileSync(githubEventPath, 'utf-8'));
  const action = event.action;
  const repoId = event.repository.node_id;
  const repoOwner = event.repository.owner.login;
  const repoName = event.repository.name;
  const discussionNumber = event.discussion.number;
  const categoryNmae = event.discussion.category.slug;

  switch (action) {
    case 'created':
    case 'edited':
    case 'pinned':
    case 'unpinned':
    case 'labeled':
    case 'unlabeled':
      writeDiscussion(repoOwner, repoName, discussionNumber, repoId);
      break;
    case 'deleted':
      deleteDiscussion(categoryNmae, discussionNumber);
      break;
    case 'category_changed':
      deleteDiscussion(categoryNmae, discussionNumber);
      writeDiscussion(repoOwner, repoName, discussionNumber, repoId);
      break;
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

const a = {
  action: 'edited',
  changes: { body: { from: '1' } },
  discussion: {
    active_lock_reason: null,
    answer_chosen_at: null,
    answer_chosen_by: null,
    answer_html_url: null,
    author_association: 'OWNER',
    body: '11',
    category: {
      created_at: '2024-08-08T07:08:03.000+08:00',
      description: 'memo1',
      emoji: ':hash:',
      id: 42328614,
      is_answerable: false,
      name: 'memo',
      node_id: 'DIC_kwDOMc_Hes4CheIm',
      repository_id: 835700602,
      slug: 'memo',
      updated_at: '2024-08-08T07:08:03.000+08:00',
    },
    comments: 0,
    created_at: '2024-08-07T23:08:19Z',
    html_url: 'https://github.com/huxinfeng/test/discussions/10',
    id: 7023555,
    labels: [],
    locked: false,
    node_id: 'D_kwDOMc_Hes4AayvD',
    number: 10,
    reactions: {
      '+1': 0,
      '-1': 0,
      confused: 0,
      eyes: 0,
      heart: 0,
      hooray: 0,
      laugh: 0,
      rocket: 0,
      total_count: 0,
      url: 'https://api.github.com/repos/huxinfeng/test/discussions/10/reactions',
    },
    repository_url: 'https://api.github.com/repos/huxinfeng/test',
    state: 'open',
    state_reason: null,
    timeline_url: 'https://api.github.com/repos/huxinfeng/test/discussions/10/timeline',
    title: '12',
    updated_at: '2024-08-07T23:09:20Z',
    user: {
      avatar_url: 'https://avatars.githubusercontent.com/u/63422671?v=4',
      events_url: 'https://api.github.com/users/huxinfeng/events{/privacy}',
      followers_url: 'https://api.github.com/users/huxinfeng/followers',
      following_url: 'https://api.github.com/users/huxinfeng/following{/other_user}',
      gists_url: 'https://api.github.com/users/huxinfeng/gists{/gist_id}',
      gravatar_id: '',
      html_url: 'https://github.com/huxinfeng',
      id: 63422671,
      login: 'huxinfeng',
      node_id: 'MDQ6VXNlcjYzNDIyNjcx',
      organizations_url: 'https://api.github.com/users/huxinfeng/orgs',
      received_events_url: 'https://api.github.com/users/huxinfeng/received_events',
      repos_url: 'https://api.github.com/users/huxinfeng/repos',
      site_admin: false,
      starred_url: 'https://api.github.com/users/huxinfeng/starred{/owner}{/repo}',
      subscriptions_url: 'https://api.github.com/users/huxinfeng/subscriptions',
      type: 'User',
      url: 'https://api.github.com/users/huxinfeng',
    },
  },
  repository: {
    allow_forking: true,
    archive_url: 'https://api.github.com/repos/huxinfeng/test/{archive_format}{/ref}',
    archived: false,
    assignees_url: 'https://api.github.com/repos/huxinfeng/test/assignees{/user}',
    blobs_url: 'https://api.github.com/repos/huxinfeng/test/git/blobs{/sha}',
    branches_url: 'https://api.github.com/repos/huxinfeng/test/branches{/branch}',
    clone_url: 'https://github.com/huxinfeng/test.git',
    collaborators_url: 'https://api.github.com/repos/huxinfeng/test/collaborators{/collaborator}',
    comments_url: 'https://api.github.com/repos/huxinfeng/test/comments{/number}',
    commits_url: 'https://api.github.com/repos/huxinfeng/test/commits{/sha}',
    compare_url: 'https://api.github.com/repos/huxinfeng/test/compare/{base}...{head}',
    contents_url: 'https://api.github.com/repos/huxinfeng/test/contents/{+path}',
    contributors_url: 'https://api.github.com/repos/huxinfeng/test/contributors',
    created_at: '2024-07-30T11:09:31Z',
    default_branch: 'main',
    deployments_url: 'https://api.github.com/repos/huxinfeng/test/deployments',
    description: null,
    disabled: false,
    downloads_url: 'https://api.github.com/repos/huxinfeng/test/downloads',
    events_url: 'https://api.github.com/repos/huxinfeng/test/events',
    fork: false,
    forks: 0,
    forks_count: 0,
    forks_url: 'https://api.github.com/repos/huxinfeng/test/forks',
    full_name: 'huxinfeng/test',
    git_commits_url: 'https://api.github.com/repos/huxinfeng/test/git/commits{/sha}',
    git_refs_url: 'https://api.github.com/repos/huxinfeng/test/git/refs{/sha}',
    git_tags_url: 'https://api.github.com/repos/huxinfeng/test/git/tags{/sha}',
    git_url: 'git://github.com/huxinfeng/test.git',
    has_discussions: true,
    has_downloads: true,
    has_issues: true,
    has_pages: false,
    has_projects: true,
    has_wiki: false,
    homepage: null,
    hooks_url: 'https://api.github.com/repos/huxinfeng/test/hooks',
    html_url: 'https://github.com/huxinfeng/test',
    id: 835700602,
    is_template: false,
    issue_comment_url: 'https://api.github.com/repos/huxinfeng/test/issues/comments{/number}',
    issue_events_url: 'https://api.github.com/repos/huxinfeng/test/issues/events{/number}',
    issues_url: 'https://api.github.com/repos/huxinfeng/test/issues{/number}',
    keys_url: 'https://api.github.com/repos/huxinfeng/test/keys{/key_id}',
    labels_url: 'https://api.github.com/repos/huxinfeng/test/labels{/name}',
    language: 'TypeScript',
    languages_url: 'https://api.github.com/repos/huxinfeng/test/languages',
    license: null,
    merges_url: 'https://api.github.com/repos/huxinfeng/test/merges',
    milestones_url: 'https://api.github.com/repos/huxinfeng/test/milestones{/number}',
    mirror_url: null,
    name: 'test',
    node_id: 'R_kgDOMc_Heg',
    notifications_url: 'https://api.github.com/repos/huxinfeng/test/notifications{?since,all,participating}',
    open_issues: 0,
    open_issues_count: 0,
    owner: {
      avatar_url: 'https://avatars.githubusercontent.com/u/63422671?v=4',
      events_url: 'https://api.github.com/users/huxinfeng/events{/privacy}',
      followers_url: 'https://api.github.com/users/huxinfeng/followers',
      following_url: 'https://api.github.com/users/huxinfeng/following{/other_user}',
      gists_url: 'https://api.github.com/users/huxinfeng/gists{/gist_id}',
      gravatar_id: '',
      html_url: 'https://github.com/huxinfeng',
      id: 63422671,
      login: 'huxinfeng',
      node_id: 'MDQ6VXNlcjYzNDIyNjcx',
      organizations_url: 'https://api.github.com/users/huxinfeng/orgs',
      received_events_url: 'https://api.github.com/users/huxinfeng/received_events',
      repos_url: 'https://api.github.com/users/huxinfeng/repos',
      site_admin: false,
      starred_url: 'https://api.github.com/users/huxinfeng/starred{/owner}{/repo}',
      subscriptions_url: 'https://api.github.com/users/huxinfeng/subscriptions',
      type: 'User',
      url: 'https://api.github.com/users/huxinfeng',
    },
    private: false,
    pulls_url: 'https://api.github.com/repos/huxinfeng/test/pulls{/number}',
    pushed_at: '2024-08-07T21:53:35Z',
    releases_url: 'https://api.github.com/repos/huxinfeng/test/releases{/id}',
    size: 67184,
    ssh_url: 'git@github.com:huxinfeng/test.git',
    stargazers_count: 0,
    stargazers_url: 'https://api.github.com/repos/huxinfeng/test/stargazers',
    statuses_url: 'https://api.github.com/repos/huxinfeng/test/statuses/{sha}',
    subscribers_url: 'https://api.github.com/repos/huxinfeng/test/subscribers',
    subscription_url: 'https://api.github.com/repos/huxinfeng/test/subscription',
    svn_url: 'https://github.com/huxinfeng/test',
    tags_url: 'https://api.github.com/repos/huxinfeng/test/tags',
    teams_url: 'https://api.github.com/repos/huxinfeng/test/teams',
    topics: [],
    trees_url: 'https://api.github.com/repos/huxinfeng/test/git/trees{/sha}',
    updated_at: '2024-08-07T21:53:38Z',
    url: 'https://api.github.com/repos/huxinfeng/test',
    visibility: 'public',
    watchers: 0,
    watchers_count: 0,
    web_commit_signoff_required: false,
  },
  sender: {
    avatar_url: 'https://avatars.githubusercontent.com/u/63422671?v=4',
    events_url: 'https://api.github.com/users/huxinfeng/events{/privacy}',
    followers_url: 'https://api.github.com/users/huxinfeng/followers',
    following_url: 'https://api.github.com/users/huxinfeng/following{/other_user}',
    gists_url: 'https://api.github.com/users/huxinfeng/gists{/gist_id}',
    gravatar_id: '',
    html_url: 'https://github.com/huxinfeng',
    id: 63422671,
    login: 'huxinfeng',
    node_id: 'MDQ6VXNlcjYzNDIyNjcx',
    organizations_url: 'https://api.github.com/users/huxinfeng/orgs',
    received_events_url: 'https://api.github.com/users/huxinfeng/received_events',
    repos_url: 'https://api.github.com/users/huxinfeng/repos',
    site_admin: false,
    starred_url: 'https://api.github.com/users/huxinfeng/starred{/owner}{/repo}',
    subscriptions_url: 'https://api.github.com/users/huxinfeng/subscriptions',
    type: 'User',
    url: 'https://api.github.com/users/huxinfeng',
  },
};
console.log(a);
