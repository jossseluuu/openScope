[![openScope Current Release](https://img.shields.io/github/v/release/openscope/openscope.svg)](https://github.com/openscope/openscope/releases)
[![Production Build State](https://img.shields.io/github/actions/workflow/status/openscope/openscope/push.yml?branch=master)](https://github.com/openscope/openscope/tree/master)
[![Coverage Status](https://coveralls.io/repos/github/openscope/openscope/badge.svg?branch=develop)](https://coveralls.io/github/openscope/openscope?branch=develop)
[![Slack Status](https://img.shields.io/badge/slack-join-yellow)](https://join.slack.com/t/openscopeatc/shared_invite/zt-g9wq2mch-B7Z9IltlgxgCBC2dBYPjiw)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE.md)

# openScope Air Traffic Control Simulator

## About this fork: AI air traffic controllers

This fork adds AI controllers that run an entire airport (arrivals, approach,
landing, taxi, takeoff and departure) using only the commands a human controller can
give, under real ICAO, EASA and FAA separation rules. The documentation of the fork is
in Spanish.

- **Realism layer:** per-airport regulatory profiles, radar, wake turbulence and
  parallel-approach separation, terrain clearance and minimum vectoring altitudes,
  and squawk 7700 emergencies ([emergencias.md](documentation/emergencias.md)).
- **New airports:** Madrid-Barajas (LEMD) and Málaga (LEMG), from the Spanish AIP
  ([LEMD guide](documentation/airport-guides/lemd.md),
  [LEMG guide](documentation/airport-guides/lemg.md)).
- **Headless simulator:** deterministic and faster than real time, driven from Python
  as a Gymnasium-style environment ([tools/sim](tools/sim/README.md)).
- **Bot A**, expert rules and metaheuristics ([bot-a.md](documentation/bot-a.md)).
- **Bot B**, reinforcement learning with PPO, exported to ONNX for the browser
  ([bot-b.md](documentation/bot-b.md)).
- **Bot C**, specialist agents with supervisors that audit every instruction
  ([bot-c.md](documentation/bot-c.md)).
- Training guide: [bot-training.md](documentation/bot-training.md); shared reference:
  [bot-information.md](documentation/bot-information.md).

In the game, type `bot a`, `bot b` or `bot c` in the command bar to hand control to a
bot, and `bot off` to take it back.

---

Visit http://openscope.io to begin playing now!

If you're just getting started, try the tutorial and see the [command reference](documentation/commands.md) for a full list of commands you can use. For information on each airport, see the [airport guide](documentation/airport-guides/airport-guide-directory.md).

Feel free to [join us on slack](https://join.slack.com/t/openscopeatc/shared_invite/zt-g9wq2mch-B7Z9IltlgxgCBC2dBYPjiw) if you have questions, comments or would like to contribute to the project. We can then add you to the organization so you can begin committing to this repo.

---

## Developer Quick Start

_Prerequisites: In order to successfully complete this quick start, you will need to have the following installed locally:_

- [Git](https://git-scm.com/downloads)
- [Node](https://nodejs.org/en/download/)

_Installation directions are beyond the scope of this document.  Instead, search the [Google](http://google.com).  Installing these two packages has been written about ad-nauseum._

From a terminal (or GitBash for Windows users), run the following commands:

1. `git clone https://github.com/openscope/openscope.git`
1. `cd openscope`
1. `npm install`
1. `npm run build`
1. `npm run start`

Once that finishes doing its thing, you should see something close to the following in the terminal:

```bash
> node ./public/assets/scripts/server/index.js

Listening on PORT 3003
```

Success!!

You you do not see this message and are having trouble getting set up, please join us on [Slack](https://join.slack.com/t/openscopeatc/shared_invite/zt-g9wq2mch-B7Z9IltlgxgCBC2dBYPjiw) and someone will be able to troubleshoot with you.

For more information on the available tools, please view the [Tools Readme](tools/README.md).

## Contributing

We do not use forks. Instead, we add to add all contributors to the openScope organization. This way, we can keep all branches local to the organization, and use testing integrations on pull requests. If you are interested in contributing, _please message Erik Quinn or Nate Geslin on slack_ so you can be added to the organization.

We use the [GitFlow Branching Model](http://nvie.com/posts/a-successful-git-branching-model) for managing branches.  If you would like to contribute, you will be expected to use appropriate branch names based on this methodology (and we can help if you have questions).

Don't know Javascript?  That's cool, we're always looking for beta testers and/or airport contributors.  If you would like to add a new airport, or help update existing airports, please read the [Airport Format Documentation](documentation/airport-format.md) and [Airport File Standards Documentation](documentation/airport-file-standards.md) to get up to speed on what is expected in that file.

## Privacy Disclosures

We use Google Analytics for gathering data about how our app is used. See [Event Tracking](documentation/event-tracking.md) for more information.

## License

[MIT License](LICENSE.md)
