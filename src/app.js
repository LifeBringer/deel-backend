const express = require("express");
const bodyParser = require("body-parser");
const { sequelize } = require("./model");
const { getProfile } = require("./middleware/getProfile");
const app = express();
app.use(bodyParser.json());
app.set("sequelize", sequelize);
app.set("models", sequelize.models);

const { Op } = require("sequelize");

/**
 * User profile is represented by userID
 * @returns contract by id
 */
app.get("/contracts/:id", getProfile, async (req, res) => {
  const { Contract } = req.app.get("models");
  const { id } = req.params;
  const contract = await Contract.findOne({
    where: { id, ClientId: req.profile.id },
  });
  if (!contract)
    return res.status(404).end("Contract not found for profile provided");
  res.json(contract);
});

app.get("/contracts/", getProfile, async (req, res) => {
  const { Contract } = req.app.get("models");
  const contract = await Contract.findAll({
    where: {
      [Op.or]: [{ ClientId: req.profile.id }, { ContractorId: req.profile.id }],
      status: { [Op.ne]: "terminated" },
    },
  });
  if (!contract)
    return res
      .status(404)
      .end("No active contracts found for profile provided");
  res.json(contract);
});

app.get("/jobs/unpaid", getProfile, async (req, res) => {
  const { Contract, Job } = req.app.get("models");
  const { id } = req.params;
  const contract = await Contract.findAll({
    where: {
      [Op.or]: [{ ClientId: req.profile.id }, { ContractorId: req.profile.id }],
      status: "in_progress",
    },
  });
  const jobs = await Job.findAll({
    where: {
      ContractId: { [Op.in]: contract.map((c) => c.id) },
      paid: null,
    },
  });

  if (!jobs)
    return res.status(404).end("No unpaid jobs found for profile provided");
  res.json(jobs);
});

app.post("/jobs/:job_id/pay", getProfile, async (req, res) => {
  try {
    const { Contract, Job, Profile } = req.app.get("models");
    const ClientId = req.profile.id;
    const { job_id: ContractId } = req.params;

    const job = await Job.findOne({ where: { ContractId } });
    if (!job) throw "Job not found";
    if (job.paid) throw "Job already paid";
    const { price } = job.dataValues;

    const contract = await Contract.findOne({
      where: { id: ContractId, ClientId, status: "in_progress" },
    });
    const { ContractorId } = contract;

    const client = await Profile.findOne({ where: { id: ClientId } });
    const { balance } = client.dataValues;

    if (balance < price) {
      throw "Invalid balance";
    }

    const contractor = await Profile.findOne({ where: { id: ContractorId } });
    if (!contractor) throw "Contractor not found";
    contractor.balance += price;
    await contractor.save();

    client.balance -= price;
    await client.save();

    job.paid = true;
    job.paymentDate = new Date();
    await job.save();

    contract.status = "terminated";
    await contract.save();
    res.json({ message: "Success" });
  } catch (error) {
    res.status(404).end(error);
  }
});

module.exports = app;
